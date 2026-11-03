import { test } from "node:test";
import assert from "node:assert/strict";
import { newMachine, step } from "../src/pvm/machine.ts";
import { assemble } from "../src/pvm/program.ts";
import { OPERATIONS, operationOf } from "../src/pvm/arithmetic.ts";
import { opcodeInfo } from "../src/pvm/instructions.ts";

const MAX = 2n ** 64n - 1n; // all 64 bits set: −1, read as signed
const neg = (x: bigint) => 2n ** 64n - x; // −x, as 64 unsigned bits

/** The registers after running one instruction on them. */
function after(instruction: number[], registers: bigint[]): bigint[] {
  const machine = newMachine(assemble([instruction]), registers);
  step(machine);
  return machine.registers;
}

// Three-register instructions are [opcode, A + 16·B, D]: here A = r0, B = r1, D = r2.
const three = (opcode: number, r0: bigint, r1: bigint, r2 = 0n) =>
  after([opcode, 0x10, 2], [r0, r1, r2])[2];

test("a 32-bit result is sign-extended to 64 bits", () => {
  const add32: bigint = three(190, 0x7fffffffn, 1n); // add_32
  assert.equal(add32, 0xffffffff80000000n);
});

test("dividing by zero gives all ones; −2^63 ÷ −1 keeps −2^63", () => {
  const byZero: bigint = three(203, 5n, 0n); // div_u_64
  assert.equal(byZero, MAX);
  const overflow: bigint = three(204, 2n ** 63n, MAX); // div_s_64
  assert.equal(overflow, 2n ** 63n);
});

test("signed division rounds towards zero; the remainder keeps the dividend's sign", () => {
  const quotient: bigint = three(204, neg(7n), 2n); // −7 ÷ 2 = −3
  assert.equal(quotient, neg(3n));
  const remainder: bigint = three(206, neg(7n), 2n); // rem_s_64: −7 rem 2 = −1
  assert.equal(remainder, neg(1n));
  const positiveRemainder: bigint = three(206, 7n, neg(3n)); // 7 rem −3 = 1
  assert.equal(positiveRemainder, 1n);
});

test("shifts: arithmetic keeps the sign, logical doesn't", () => {
  const arithmetic: bigint = three(209, neg(8n), 1n); // shar_r_64
  assert.equal(arithmetic, neg(4n));
  const logical: bigint = three(208, 2n ** 63n, 63n); // shlo_r_64
  assert.equal(logical, 1n);
});

test("rotations carry the bits round", () => {
  const rotatedRight: bigint = three(222, 1n, 1n); // rot_r_64: bit 0 to bit 63
  assert.equal(rotatedRight, 2n ** 63n);
  const rotatedLeft: bigint = three(221, 0x80000000n, 1n); // rot_l_32: bit 31 to bit 0
  assert.equal(rotatedLeft, 1n);
});

test("immediate forms: φ_B with ν_X, and the alt forms the other way round", () => {
  // [opcode, A + 16·B, ν_X]: A = r2 gets the result, B = r1 holds 4, ν_X = 3
  const shifted: bigint = after([138, 0x12, 3], [0n, 4n])[2]; // shlo_l_imm_32: 4 << 3
  assert.equal(shifted, 32n);
  const shiftedAlt: bigint = after([144, 0x12, 3], [0n, 4n])[2]; // shlo_l_imm_alt_32: 3 << 4
  assert.equal(shiftedAlt, 48n);
});

test("cmov: move only if the condition register is zero (iz) or not (nz)", () => {
  const moved: bigint = three(218, 9n, 0n, 5n); // cmov_iz: r1 = 0, so r2 = r0
  assert.equal(moved, 9n);
  const stayed: bigint = three(218, 9n, 1n, 5n); // r1 ≠ 0, so r2 stays
  assert.equal(stayed, 5n);
  const movedImm: bigint = after([147, 0x12, 7], [0n, 0n, 5n])[2]; // cmov_iz_imm: r2 = 7
  assert.equal(movedImm, 7n);
});

test("the upper half of a product, and min/max signed or not", () => {
  const upper: bigint = three(214, MAX, MAX); // mul_upper_u_u: (2^64 − 1)² >> 64
  assert.equal(upper, MAX - 1n);
  const signedMax: bigint = three(227, MAX, 1n); // max: −1 < 1
  assert.equal(signedMax, 1n);
  const unsignedMax: bigint = three(228, MAX, 1n); // max_u: 2^64 − 1 > 1
  assert.equal(unsignedMax, MAX);
});

test("every arithmetic instruction in the GP's tables has an operation: 72 of them", () => {
  let covered = 0;
  for (let opcode = 0; opcode < 256; opcode++) {
    const info = opcodeInfo(opcode);
    const arithmetic = (opcode >= 131 && opcode <= 161) || opcode >= 190; // not loads or stores
    if (!info || !arithmetic) continue;
    const operation = OPERATIONS[operationOf(info.name).operation];
    assert.ok(operation, info.name);
    covered++;
  }
  assert.equal(covered, 72); // 31 with an immediate, 41 with three registers
});
