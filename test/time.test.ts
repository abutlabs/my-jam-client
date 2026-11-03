import { test } from "node:test";
import assert from "node:assert/strict";
import { slotAt } from "../src/time.ts";

const at = (iso: string) => slotAt(new Date(iso));

test("slot 0 is the first six seconds of the JAM Common Era", () => {
  const eraStart: number = at("2025-01-01T12:00:00Z");
  assert.equal(eraStart, 0);
  const lastMoment: number = at("2025-01-01T12:00:05.999Z");
  assert.equal(lastMoment, 0);
  const sixSecondsIn: number = at("2025-01-01T12:00:06Z");
  assert.equal(sixSecondsIn, 1);
});

test("an hour is 600 slots", () => {
  const anHourIn: number = at("2025-01-01T13:00:00Z");
  assert.equal(anHourIn, 600);
});
