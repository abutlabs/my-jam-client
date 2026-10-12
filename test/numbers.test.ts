import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex } from "../src/bytes.ts";
import { decodeFixed, encodeFixed } from "../src/codec/numbers.ts";
import type { Bytes } from "../src/bytes.ts";

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