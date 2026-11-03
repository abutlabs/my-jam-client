import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex } from "../src/bytes.ts";
import { deblob, startsInstruction, unpackCode } from "../src/pvm/program.ts";
import { bootstrapCode } from "./vectors.ts";
import type { Program, ServiceCode } from "../src/pvm/program.ts";
import type { Bytes } from "../src/bytes.ts";

test("deblob by hand: one jump, three bytes of code, two instructions", () => {
  // |j| = 1, z = 1, |c| = 3 | j = [2] | c = 00 01 02 | k = 0000 0101: bytes 0 and 2 start one
  const program: Program = deblob(fromHex("0x01010302" + "000102" + "05"));
  assert.deepEqual(program.jumpTable, [2]);
  const codeHex: string = toHex(program.code);
  assert.equal(codeHex, "0x000102");
  const starts: boolean[] = [0, 1, 2].map((i) => startsInstruction(program, i));
  assert.deepEqual(starts, [true, false, true]);
});

test("a real service's code: metadata, then a standard program that ends it exactly", () => {
  const preimage: Bytes = bootstrapCode();
  const code: ServiceCode = unpackCode(preimage);
  const metadata: string = new TextDecoder().decode(code.metadata);
  const named: boolean = metadata.includes("jam-bootstrap-service");
  assert.equal(named, true);
  assert.deepEqual([code.readOnly.length, code.readWrite.length], [9904, 48]);
  assert.deepEqual([code.heapPages, code.stackSize], [2, 8192]);
  const tail: Bytes = preimage.subarray(preimage.length - code.program.length);
  assert.deepEqual(tail, code.program); // nothing left over after the PVM blob
});

test("its PVM blob: 39,849 instructions, and all 1,601 jumps land on one", () => {
  const program: Program = deblob(unpackCode(bootstrapCode()).program);
  let instructions = 0;
  for (let i = 0; i < program.code.length; i++) if (startsInstruction(program, i)) instructions++;
  assert.equal(instructions, 39849);
  const startsAtZero: boolean = startsInstruction(program, 0); // the code starts with one
  assert.equal(startsAtZero, true);
  assert.equal(program.jumpTable.length, 1601);
  for (const target of program.jumpTable) {
    const lands: boolean = startsInstruction(program, target);
    assert.ok(lands);
  }
});
