import { test } from "node:test";
import assert from "node:assert/strict";
import { Block } from "../src/block.ts";
import { FULL, TINY } from "../src/config.ts";
import { entropyHistory, epochOf, phaseOf } from "../src/epoch.ts";
import { readEntropy, readTime } from "../src/state.ts";
import { traceState } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";

test("an epoch is E slots: 12 on tiny, 600 on full", () => {
  const tinyEpoch: number = epochOf(TINY, 25);
  const tinyPhase: number = phaseOf(TINY, 25);
  assert.deepEqual([tinyEpoch, tinyPhase], [2, 1]);
  const fullEpoch: number = epochOf(FULL, 1234);
  const fullPhase: number = phaseOf(FULL, 1234);
  assert.deepEqual([fullEpoch, fullPhase], [2, 34]);
});

/** Block n of the tiny "safrole" trace, the time before it, and whether it starts an epoch. */
function step(n: number) {
  const { entries, block } = traceState("safrole", n);
  const header = Block(TINY).fromJson(block).header;
  const time = readTime(entries);
  const newEpoch = epochOf(TINY, header.slot) > epochOf(TINY, time);
  return { header, entries, newEpoch };
}

test("an epoch mark is in exactly the blocks that start a new epoch", () => {
  let marks = 0;
  for (let n = 1; n <= 100; n++) {
    const { header, newEpoch } = step(n);
    const hasMark: boolean = header.epoch_mark !== null;
    assert.equal(hasMark, newEpoch, `block ${n}`);
    if (newEpoch) marks++;
  }
  assert.equal(marks, 8);
});

test("at a new epoch the entropy history moves along one; otherwise it stays", () => {
  for (let n = 1; n < 100; n++) {
    const { entries, newEpoch } = step(n);
    const after: Bytes[] = readEntropy(traceState("safrole", n + 1).entries); // after block n
    const afterHistory: Bytes[] = after.slice(1);
    const moved: Bytes[] = entropyHistory(readEntropy(entries), newEpoch);
    assert.deepEqual(afterHistory, moved, `block ${n}`);
  }
});