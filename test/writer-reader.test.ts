import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex } from "../src/bytes.ts";
import { Reader } from "../src/codec/reader.ts";
import { Writer } from "../src/codec/writer.ts";
import type { Bytes } from "../src/bytes.ts";

test("a reader reads back what a writer wrote, in the same order", () => {
  const w: Writer = new Writer();
  w.fixed(4807n, 2);
  w.natural(128n);
  w.bytes(fromHex("0xdeadbeef"));
  const bytes: Bytes = w.finish();
  const written: string = toHex(bytes);
  assert.equal(written, "0xc7128080deadbeef");

  const r: Reader = new Reader(bytes);
  const fixed: bigint = r.fixed(2);
  assert.equal(fixed, 4807n);
  const natural: bigint = r.natural();
  assert.equal(natural, 128n);
  const tail: Bytes = r.bytes(4);
  assert.deepEqual(tail, fromHex("0xdeadbeef"));
});
