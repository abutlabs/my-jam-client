import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeNatural } from "../src/codec/numbers.ts";
import { HALT_ADDRESS, newMachine, run, step } from "../src/pvm/machine.ts";
import { readMemory, writeMemory } from "../src/pvm/memory.ts";
import { assemble, deblob, unpackCode } from "../src/pvm/program.ts";
import { standardProgram } from "../src/pvm/standard.ts";
import { bootstrapCode } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";
import type { MemoryError } from "../src/pvm/memory.ts";
import type { Exit, Machine } from "../src/pvm/machine.ts";
import type { ServiceCode } from "../src/pvm/program.ts";

/** A tiny standard program: 3 bytes of o, 2 of w, a page of heap, 100 bytes of stack. */
const TINY_PROGRAM = {
  metadata: new Uint8Array(0),
  readOnly: Uint8Array.from([1, 2, 3]),
  readWrite: Uint8Array.from([4, 5]),
  heapPages: 1,
  stackSize: 100,
  program: new Uint8Array(0),
};

test("Y lays out memory: o a zone up, w a zone after it, the stack and arguments up top", () => {
  const { memory } = standardProgram(TINY_PROGRAM, Uint8Array.from([9]));
  const o: Bytes | MemoryError = readMemory(memory, 0x10000n, 3);
  assert.deepEqual(o, Uint8Array.from([1, 2, 3]));
  const zero: Bytes = Uint8Array.of(0);
  const intoO: MemoryError | null = writeMemory(memory, 0x10000n, zero); // o is read only
  assert.deepEqual(intoO, { fault: 0x10000 });
  const w: Bytes | MemoryError = readMemory(memory, 0x30000n, 2);
  assert.deepEqual(w, Uint8Array.from([4, 5]));
  // the heap page, after w's page
  const intoHeap: MemoryError | null = writeMemory(memory, 0x31fffn, zero);
  assert.equal(intoHeap, null);
  const intoStack: MemoryError | null = writeMemory(memory, 0xfefdf000n, zero); // its one page
  assert.equal(intoStack, null);
  const args: Bytes | MemoryError = readMemory(memory, 0xfeff0000n, 1);
  assert.deepEqual(args, Uint8Array.from([9]));
  const gap: Bytes | MemoryError = readMemory(memory, 0x32000n, 1); // and gaps between
  assert.deepEqual(gap, { fault: 0x32000 });
});

test("Y's registers: the halt address, the stack pointer, and where the arguments are", () => {
  const { registers } = standardProgram(TINY_PROGRAM, Uint8Array.from([9]));
  assert.equal(registers[0], HALT_ADDRESS);
  assert.equal(registers[1], 0xfefe0000n); // 2^32 − 2·2^16 − 2^24: the top of the stack
  assert.equal(registers[7], 0xfeff0000n); // 2^32 − 2^16 − 2^24
  assert.equal(registers[8], 1n);
});

test("ecalli stops the machine to call the host, and stays on the ecalli", () => {
  const machine: Machine = newMachine(assemble([[10, 2]])); // ecalli 2
  const exit: Exit = step(machine);
  assert.deepEqual(exit, { host: 2 });
  assert.equal(machine.pc, 0);
});

test("a real service starts: the bootstrap service runs until it calls fetch", () => {
  const code: ServiceCode = unpackCode(bootstrapCode());
  const args: Bytes = Uint8Array.from([
    ...encodeNatural(1n),
    ...encodeNatural(0n),
    ...encodeNatural(0n),
  ]);
  const { memory, registers } = standardProgram(code, args); // slot 1, service 0, 0 inputs
  const machine: Machine = newMachine(deblob(code.program), registers, memory);
  machine.pc = 5; // where accumulation starts
  const exit: Exit = run(machine);
  assert.deepEqual(exit, { host: 2 }); // host call 2 is fetch
  assert.equal(machine.registers[10], 0n); // asking for item 0: the protocol constants
});
