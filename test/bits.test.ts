import { test } from "node:test";
import assert from "node:assert/strict";
import { BIT_OPERATIONS } from "../src/pvm/bits.ts";
import { opcodeInfo } from "../src/pvm/instructions.ts";
import { newMachine, step } from "../src/pvm/machine.ts";
import { assemble } from "../src/pvm/program.ts";

const MAX = 2n ** 64n - 1n; // all 64 bits set

/** φ′_D after one two-register instruction, [opcode, D + 16·A]: here D = r1, A = r0. */
function one(opcode: number, r0: bigint): bigint {
  const machine = newMachine(assemble([[opcode, 0x01]]), [r0]);
  step(machine);
  return machine.registers[1];
}

test("counting bits: the 1s, the 0s before the first 1, the 0s after the last", () => {
  const setBits: bigint = one(101, 0b1011n); // count_set_bits_64
  assert.equal(setBits, 3n);
  const leadingZeros: bigint = one(103, 1n); // leading_zero_bits_64: 63 zeros, then the 1
  assert.equal(leadingZeros, 63n);
  const trailingZeros: bigint = one(105, 0b1000n); // trailing_zero_bits_64
  assert.equal(trailingZeros, 3n);
});

test("the 32-bit counts see only the low 32 bits, and zero is all zeros", () => {
  const setBits32: bigint = one(102, MAX); // count_set_bits_32
  assert.equal(setBits32, 32n);
  const leadingZeros32: bigint = one(104, 1n); // leading_zero_bits_32
  assert.equal(leadingZeros32, 31n);
  const allZeros: bigint = one(103, 0n); // leading_zero_bits_64: no 1 to stop at
  assert.equal(allZeros, 64n);
  const trailingZeros32: bigint = one(106, 0n); // trailing_zero_bits_32
  assert.equal(trailingZeros32, 32n);
});

test("extending: the lowest byte or two, read as signed or unsigned", () => {
  const signExtended8: bigint = one(107, 0x180n); // sign_extend_8: 0x80 is −128
  assert.equal(signExtended8, MAX - 127n);
  const signExtended16: bigint = one(108, 0x12345n); // sign_extend_16: 0x2345 is positive
  assert.equal(signExtended16, 0x2345n);
  const zeroExtended16: bigint = one(109, MAX); // zero_extend_16
  assert.equal(zeroExtended16, 0xffffn);
});

test("reverse_bytes turns little-endian into big-endian", () => {
  const reversed: bigint = one(110, 0x0102030405060708n);
  assert.equal(reversed, 0x0807060504030201n);
});

test("every two-register instruction after move_reg has an operation: 10 of them", () => {
  for (let opcode = 101; opcode <= 110; opcode++) {
    const { name } = opcodeInfo(opcode)!;
    const operation = BIT_OPERATIONS[name];
    assert.ok(operation, name);
  }
  const beyond = opcodeInfo(111); // and the table ends there
  assert.equal(beyond, undefined);
});
