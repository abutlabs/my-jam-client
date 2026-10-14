import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex } from "../src/bytes.ts";
import { decodeFixed, encodeFixed } from "../src/codec/numbers.ts";
import type { Bytes } from "../src/bytes.ts";
import { toHex } from "../src/bytes.ts";
import { decodeNatural, encodeNatural } from "../src/codec/numbers.ts";

const NATURALS: [bigint, string][] = [
  [0n, "0x00"],
  [127n, "0x7f"],
  [128n, "0x8080"],
  [16384n, "0xc00040"],
  [2n ** 64n - 70n, "0xffbaffffffffffffff"],
];

test("ℰ_l writes the least significant byte first", () => {
  const twoBytes: Bytes = encodeFixed(4807n, 2);
  assert.deepEqual(twoBytes, fromHex("0xc712"));
  const fourBytes: Bytes = encodeFixed(1n, 4);
  assert.deepEqual(fourBytes, fromHex("0x01000000"));
});

test("decoding reads the bytes back", () => {
  const decoded: bigint = decodeFixed(fromHex("0xc712"));
  assert.equal(decoded, 4807n);
  const big: bigint = 2n ** 64n - 70n;
  const encoded: Bytes = encodeFixed(big, 8);
  const back: bigint = decodeFixed(encoded);
  assert.equal(back, big);
});

test("ℰ, the compact natural, at different lengths", () => {
  for (const [x, hex] of NATURALS) {
    const encodedHex: string = toHex(encodeNatural(x));
    assert.equal(encodedHex, hex, `ℰ(${x})`);
    const decoded: { value: bigint; length: number } = decodeNatural(fromHex(hex));
    const expected: { value: bigint; length: number } = { value: x, length: (hex.length - 2) / 2 };
    assert.deepEqual(decoded, expected);
  }
});

test("decodeNatural can start in the middle of the bytes", () => {
  const decoded: { value: bigint; length: number } = decodeNatural(fromHex("0xaa8080"), 1);
  assert.deepEqual(decoded, { value: 128n, length: 2 });
});