import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex } from "../src/bytes.ts";
import { blob, decode, encode, hash, natural, natural32, u16, u32, u64, u8, record, seq, option, seqN } from "../src/codec/codec.ts";
import type { Bytes } from "../src/bytes.ts";
import type { Value } from "../src/codec/codec.ts";

test("integers encode as ℰ_l and ℰ", () => {
  const u8Hex: string = toHex(encode(u8, 7));
  assert.equal(u8Hex, "0x07");
  const u16Hex: string = toHex(encode(u16, 4807));
  assert.equal(u16Hex, "0xc712");
  const u32Hex: string = toHex(encode(u32, 16909060));
  assert.equal(u32Hex, "0x04030201");
  const u64Hex: string = toHex(encode(u64, 42n));
  assert.equal(u64Hex, "0x2a00000000000000");
  const naturalHex: string = toHex(encode(natural, 128n));
  assert.equal(naturalHex, "0x8080");
  const decoded: number = decode(natural32, fromHex("0xc00040"));
  assert.equal(decoded, 16384);
});

test("from the vectors' JSON: u32s stay numbers, u64s become bigints", () => {
  const fromU32: number = u32.fromJson(16909060);
  assert.equal(fromU32, 16909060);
  const fromU64: bigint = u64.fromJson(42);
  assert.equal(fromU64, 42n);
});

test("a hash is 32 bytes as they are; a blob has its length in front", () => {
  const h: Bytes = new Uint8Array(32).fill(0xab);
  const hashEncoded: Bytes = encode(hash, h);
  assert.deepEqual(hashEncoded, h);
  const blobHex: string = toHex(encode(blob, fromHex("0x0102030405")));
  assert.equal(blobHex, "0x050102030405");
  const blobDecoded: Bytes = decode(blob, fromHex("0x050102030405"));
  assert.deepEqual(blobDecoded, fromHex("0x0102030405"));
});

test("a sequence has its length in front", () => {
  const seqHex: string = toHex(encode(seq(u16), [1, 2, 3]));
  assert.equal(seqHex, "0x03010002000300");
  const seqDecoded: number[] = decode(seq(u16), fromHex("0x03010002000300"));
  assert.deepEqual(seqDecoded, [1, 2, 3]);
});

const Pair = record({ slot: u32, gas: u64 });
type Pair = Value<typeof Pair>;

test("a record encodes its fields in the order written", () => {
  const p: Pair = { slot: 1, gas: 2n };
  const encoded: Bytes = encode(Pair, p);
  const pairHex: string = toHex(encoded);
  assert.equal(pairHex, "0x010000000200000000000000");
  const decoded: Pair = decode(Pair, encoded);
  assert.deepEqual(decoded, p);
  const fromJson: Pair = Pair.fromJson({ slot: 1, gas: 2 });
  assert.deepEqual(fromJson, p);
});

test("an option is 0, or 1 and the value", () => {
  const noneHex: string = toHex(encode(option(u32), null));
  assert.equal(noneHex, "0x00");
  const someHex: string = toHex(encode(option(u32), 7));
  assert.equal(someHex, "0x0107000000");
  const none: number | null = decode(option(u32), fromHex("0x00"));
  assert.equal(none, null);
  const some: number | null = decode(option(u32), fromHex("0x0107000000"));
  assert.equal(some, 7);
});

test("a fixed-length sequence has no length in front", () => {
  const fixedHex: string = toHex(encode(seqN(u16, 3), [1, 2, 3]));
  assert.equal(fixedHex, "0x010002000300");
  const fixedDecoded: number[] = decode(seqN(u16, 3), fromHex("0x010002000300"));
  assert.deepEqual(fixedDecoded, [1, 2, 3]);
});
