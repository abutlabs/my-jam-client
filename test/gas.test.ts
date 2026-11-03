import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cost } from "../src/pvm/gas.ts";
import { instructionCost, registersUsed, blockCost, runWithGas } from "../src/pvm/gas.ts";
import { decodeInstruction, opcodeInfo } from "../src/pvm/instructions.ts";
import { assemble, deblob, unpackCode } from "../src/pvm/program.ts";
import { bootstrapCode } from "./vectors.ts";
import type { Program, ServiceCode } from "../src/pvm/program.ts";
import { newMachine } from "../src/pvm/machine.ts";
import { standardProgram } from "../src/pvm/standard.ts";
import type { Exit, Machine } from "../src/pvm/machine.ts";
import type { Bytes } from "../src/bytes.ts";

/** The cost of the first instruction of a hand-made program. */
function costOf(...instructions: number[][]): Cost {
  const program = assemble(instructions);
  return instructionCost(program, decodeInstruction(program, 0));
}

test("which registers an instruction reads and writes", () => {
  const used = (bytes: number[]) => registersUsed(decodeInstruction(assemble([bytes]), 0));
  const add = used([200, 0x10, 2]); // add_64 r2 = r0 + r1
  assert.deepEqual(add, { reads: [0, 1], writes: [2] });
  const load = used([130, 0x10]); // load_ind_u64 r0, [r1]
  assert.deepEqual(load, { reads: [1], writes: [0] });
  const store = used([123, 0x10]); // store_ind_u64 r0, [r1]
  assert.deepEqual(store, { reads: [0, 1], writes: [] });
  const cmov = used([218, 0x10, 2]); // cmov_iz
  assert.deepEqual(cmov, { reads: [0, 1, 2], writes: [2] });
});

test("a row from the GP's table: add_64 is 1 cycle, and 1 or 2 decode slots", () => {
  const add: Cost = costOf([200, 0x10, 2]);
  assert.deepEqual(add, { cycles: 1, slots: 2, units: [1, 0, 0, 0, 0] });
  const addInPlace: Cost = costOf([200, 0x10, 0]); // r0 = r0 + r1: writes a register it reads
  assert.equal(addInPlace.slots, 1);
});

test("memory is slow: a load or a store takes 25 cycles, and a load unit or a store unit", () => {
  const load: Cost = costOf([130, 0x10]);
  assert.deepEqual(load, { cycles: 25, slots: 1, units: [1, 1, 0, 0, 0] });
  const store: Cost = costOf([123, 0x10]);
  assert.deepEqual(store, { cycles: 25, slots: 1, units: [1, 0, 1, 0, 0] });
});

test("dividing takes 60 cycles; ecalli takes 100", () => {
  const divide: Cost = costOf([203, 0x10, 2]); // div_u_64
  assert.equal(divide.cycles, 60);
  const ecalli: Cost = costOf([10, 0]);
  assert.equal(ecalli.cycles, 100);
});

test("a branch costs 20, or 1 if either way leads to trap or unlikely", () => {
  const eitherWay: Cost = costOf([170, 0x10, 4], [1], [1]); // both ways: fallthrough
  assert.equal(eitherWay.cycles, 20);
  const toTrap: Cost = costOf([170, 0x10, 4], [1], [0]); // the target is a trap
  assert.equal(toTrap.cycles, 1);
  const nextUnlikely: Cost = costOf([170, 0x10, 4], [2], [1]); // the next one is unlikely
  assert.equal(nextUnlikely.cycles, 1);
});

test("every instruction has a row in the cost table: 139 of them", () => {
  let rows = 0;
  for (let opcode = 0; opcode < 256; opcode++) {
    if (!opcodeInfo(opcode)) continue;
    const cost: Cost = costOf([opcode], [0]);
    assert.ok(cost.cycles >= 0, opcodeInfo(opcode)!.name);
    rows++;
  }
  assert.equal(rows, 139);
});

/** The gas a hand-made block costs, from its first instruction. */
const gas = (...instructions: number[][]) => blockCost(assemble(instructions), 0);

// load_ind_u64 is [130, A + 16·B]: φ_A from memory at φ_B. trap ends each block.
test("one instruction on its own costs its cycles: the 3 is the pipeline's overhead", () => {
  const trap: number = gas([0]); // trap
  assert.equal(trap, 2);
  const jump: number = gas([40, 0]); // jump
  assert.equal(jump, 15);
});

test("independent loads run side by side: four cost no more than one, a fifth waits", () => {
  const oneLoad: number = gas([130, 0x12], [0]); // r2 = [r1]
  assert.equal(oneLoad, 25);
  const fourLoads: number = gas([130, 0x12], [130, 0x13], [130, 0x14], [130, 0x15], [0]);
  assert.equal(fourLoads, 25);
  const fiveLoads: number = gas(
    [130, 0x12], [130, 0x13], [130, 0x14], [130, 0x15], [130, 0x16], [0],
  );
  assert.equal(fiveLoads, 50);
});

test("a load that needs another's answer waits for it", () => {
  const chainOfTwo: number = gas([130, 0x12], [130, 0x23], [0]); // r2 = [r1], then r3 = [r2]
  assert.equal(chainOfTwo, 50);
  const chainOfThree: number = gas([130, 0x12], [130, 0x23], [130, 0x34], [0]);
  assert.equal(chainOfThree, 75);
});

test("move_reg is free, and the wait follows the value through it", () => {
  const throughMove: number = gas([130, 0x12], [100, 0x25], [130, 0x53], [0]); // r5 = r2, r3 = [r5]
  assert.equal(throughMove, 50);
});

test("there's one divide unit: two divides take turns", () => {
  const oneDivide: number = gas([203, 0x10, 2], [0]); // div_u_64 r2 = r0 ÷ r1
  assert.equal(oneDivide, 60);
  const twoDivides: number = gas([203, 0x10, 2], [203, 0x10, 3], [0]);
  assert.equal(twoDivides, 120);
});

test("a real block: the bootstrap service's first costs 26, not the 91 its cycles add to", () => {
  const program: Program = deblob(unpackCode(bootstrapCode()).program);
  const first: number = blockCost(program, 92078);
  assert.equal(first, 26);
});

test("an endless loop runs out of gas: each lap pays 15, until there's too little", () => {
  const machine: Machine = newMachine(assemble([[40, 0]]), [], new Map(), 100n); // jump to itself
  const exit: Exit = runWithGas(machine);
  assert.equal(exit, "oog");
  assert.equal(machine.gas, 10n); // six laps paid for, and 10 isn't enough for a seventh
});

test("a block is paid for in full before any of it runs", () => {
  const block: Program = assemble([[51, 0x02, 7], [0]]); // load_imm r2, 7; trap: 2 gas
  const poor: Machine = newMachine(block, [], new Map(), 1n);
  const poorExit: Exit = runWithGas(poor);
  assert.equal(poorExit, "oog");
  assert.equal(poor.registers[2], 0n); // not even the load_imm ran
  const rich: Machine = newMachine(block, [], new Map(), 2n);
  const richExit: Exit = runWithGas(rich); // the trap
  assert.equal(richExit, "panic");
  assert.deepEqual([rich.registers[2], rich.gas], [7n, 0n]);
});

test("the bootstrap service spends 243 gas to reach its first host call", () => {
  const code: ServiceCode = unpackCode(bootstrapCode());
  const args: Bytes = Uint8Array.from([1, 0, 0]); // slot 1, service 0, no inputs: each one byte
  const { memory, registers } = standardProgram(code, args);
  const machine: Machine = newMachine(deblob(code.program), registers, memory, 1000n);
  machine.pc = 5; // accumulation
  const exit: Exit = runWithGas(machine);
  assert.deepEqual(exit, { host: 2 });
  assert.equal(machine.gas, 1000n - 243n);
});
