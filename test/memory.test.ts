import { test } from "node:test";
import assert from "node:assert/strict";
import { HALT_ADDRESS, newMachine, run, step } from "../src/pvm/machine.ts";
import type { Memory } from "../src/pvm/memory.ts";
import { addPages } from "../src/pvm/memory.ts";
import { assemble } from "../src/pvm/program.ts";
import type { Exit, Machine } from "../src/pvm/machine.ts";
import type { Program } from "../src/pvm/program.ts";

test("store 8 bytes, load them back, and load one as a signed byte", () => {
  const program: Program = assemble([
    [123, 0x12], //  store_ind_u64 r2 at r1 + 0
    [130, 0x13], //  load_ind_u64 r3 from r1 + 0
    [125, 0x14], //  load_ind_i8 r4 from r1 + 0: one byte, sign-extended
    [50, 0x00], //   jump_ind r0: return
  ]);
  const memory: Memory = new Map();
  addPages(memory, 0x20000, 4096, "W"); // one writable page at 0x20000
  const r2: bigint = 0x1122334455667780n; // its lowest byte, 0x80, is −128 as a signed byte
  const machine: Machine = newMachine(program, [HALT_ADDRESS, 0x20000n, r2], memory);
  const exit: Exit = run(machine);
  assert.equal(exit, "halt");
  assert.equal(machine.registers[3], r2);
  assert.equal(machine.registers[4], 2n ** 64n - 128n);
});

test("no page there: a fault at the page's address; below 2^16: a panic", () => {
  // load_u8 r1, [0x30005]
  const far: Machine = newMachine(assemble([[52, 0x01, 0x05, 0x00, 0x03]]));
  const farExit: Exit = step(far);
  assert.deepEqual(farExit, { fault: 0x30000 });
  assert.equal(far.pc, 0); // the machine stays at the instruction that faulted
  const low: Machine = newMachine(assemble([[52, 0x01, 0x00, 0x01]])); // load_u8 r1, [0x0100]
  const lowExit: Exit = step(low);
  assert.equal(lowExit, "panic");
});

test("writing a read-only page faults, and writes nothing", () => {
  const memory: Memory = new Map();
  addPages(memory, 0x10000, 4096, "R");
  // store_imm_u8 [0x10000], 42
  const program: Program = assemble([[30, 0x03, 0x00, 0x00, 0x01, 0x2a]]);
  const exit: Exit = step(newMachine(program, [], memory));
  assert.deepEqual(exit, { fault: 0x10000 });
  const firstByte: number | undefined = memory.get(0x10)?.bytes[0];
  assert.equal(firstByte, 0);
});
