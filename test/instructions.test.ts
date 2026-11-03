import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeInstruction, signed, signExtend } from "../src/pvm/instructions.ts";
import type { Program } from "../src/pvm/program.ts";
import { deblob, startsInstruction, unpackCode } from "../src/pvm/program.ts";
import { bootstrapCode } from "./vectors.ts";
import type { Instruction } from "../src/pvm/instructions.ts";

test("immediates: sign-extended to 64 bits, or read as signed", () => {
  const small: bigint = signExtend(1, 0x7fn);
  assert.equal(small, 0x7fn);
  const minusOne: bigint = signExtend(1, 0xffn);
  assert.equal(minusOne, 2n ** 64n - 1n); // −1, as 64 unsigned bits
  const twoBytes: bigint = signExtend(2, 0x8000n);
  assert.equal(twoBytes, 0xffffffffffff8000n);
  const minusThree: bigint = signed(1, 0xfdn);
  assert.equal(minusThree, -3n);
});

test("three instructions by hand: load_imm, add_64, and a jump back", () => {
  // load_imm r1, −1 | add_64 r3 = r1 + r2 | jump back 3 bytes | trap
  const code = Uint8Array.from([51, 0x01, 0xff, 200, 0x21, 0x03, 40, 0xfd, 0]);
  const program: Program = { jumpTable: [], code, bitmask: Uint8Array.from([0x49, 0x01]) };
  const loadImm: Instruction = decodeInstruction(program, 0); // they start at 0, 3, 6 and 8
  assert.deepEqual([loadImm.name, loadImm.registers, loadImm.immediates], [
    "load_imm",
    [1],
    [2n ** 64n - 1n],
  ]);
  const add: Instruction = decodeInstruction(program, 3);
  assert.deepEqual([add.name, add.registers, add.next], ["add_64", [1, 2, 3], 6]);
  const jump: Instruction = decodeInstruction(program, 6);
  assert.deepEqual([jump.name, jump.target], ["jump", 3]); // 6 + (−3)
});

test("the bootstrap service: 39,849 instructions, all known, every jump on target", () => {
  const program: Program = deblob(unpackCode(bootstrapCode()).program);
  let instructions = 0;
  let targets = 0;
  for (let i = 0; i < program.code.length; i = decodeInstruction(program, i).next) {
    const instruction: Instruction = decodeInstruction(program, i);
    instructions++;
    if (instruction.target === undefined) continue;
    const lands: boolean = startsInstruction(program, instruction.target);
    assert.ok(lands, `${instruction.name} at ${i}`);
    targets++;
  }
  assert.deepEqual([instructions, targets], [39849, 4767]);
});
