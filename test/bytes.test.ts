import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex } from "../src/bytes.ts";

test("hex there and back", () => {
  const bytes = Uint8Array.of(1, 2, 255);
  assert.equal(toHex(bytes), "0x0102ff");
  assert.deepEqual(fromHex("0x0102ff"), bytes);
});

test("no bytes at all is just 0x", () => {
  assert.equal(toHex(new Uint8Array(0)), "0x");
  assert.deepEqual(fromHex("0x"), new Uint8Array(0));
});
