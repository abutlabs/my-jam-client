import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex } from "../src/bytes.ts";
import type { Bytes } from "../src/bytes.ts";

test("hex there and back", () => {
  const bytes: Bytes = Uint8Array.of(1, 2, 255);
  const hex: string = toHex(bytes);
  assert.equal(hex, "0x0102ff");
  const back: Bytes = fromHex("0x0102ff");
  assert.deepEqual(back, bytes);
});

test("no bytes at all is just 0x", () => {
  const empty: Bytes = new Uint8Array(0);
  const hex: string = toHex(empty);
  assert.equal(hex, "0x");
  const back: Bytes = fromHex("0x");
  assert.deepEqual(back, empty);
});
