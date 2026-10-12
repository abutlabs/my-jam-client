import { test } from "node:test";
import assert from "node:assert/strict";

test("a number rounds above 2^53: 2^64 - 70 and 2^64 are the same float", () => {
  const twoTo64Minus70: number = 2 ** 64 - 70;
  const twoTo64: number = 2 ** 64;
  assert.equal(twoTo64Minus70, twoTo64);
});

test("a bigint never rounds", () => {
  const twoTo64Minus70: bigint = 2n ** 64n - 70n;
  const twoTo64: bigint = 2n ** 64n;
  assert.notEqual(twoTo64Minus70, twoTo64);
  assert.equal(twoTo64Minus70, 18446744073709551546n);
});

test("bitwise operators work on signed 32-bit integers", () => {
  const allOnes: number = 0xffffffff;
  const signed: number = allOnes | 0;
  assert.equal(signed, -1);
  const unsigned: number = signed >>> 0;
  assert.equal(unsigned, 0xffffffff);
});
