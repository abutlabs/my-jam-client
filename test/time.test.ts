import { test } from "node:test";
import assert from "node:assert/strict";
import { slotAt } from "../src/time.ts";

const at = (iso: string) => slotAt(new Date(iso));

test("slot 0 is the first six seconds of the JAM Common Era", () => {
  assert.equal(at("2025-01-01T12:00:00Z"), 0);
  assert.equal(at("2025-01-01T12:00:05.999Z"), 0);
  assert.equal(at("2025-01-01T12:00:06Z"), 1);
});

test("an hour is 600 slots", () => {
  assert.equal(at("2025-01-01T13:00:00Z"), 600);
});``