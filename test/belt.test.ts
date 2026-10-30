import { test } from "node:test";
import assert from "node:assert/strict";
import { appendToBelt, superPeak } from "../src/belt.ts";
import type { Belt } from "../src/belt.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { keccak256 } from "../src/hash.ts";
import { vectorFiles, vectorJson } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";

test("Keccak-256 of nothing at all", () => {
  const empty: string = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
  const hashed: string = toHex(keccak256(new Uint8Array(0)));
  assert.equal(hashed, empty);
});

test("appending is counting in binary: mountains of 1, 2, 4...", () => {
  const a: Bytes = new Uint8Array(32).fill(1);
  let belt: Belt = [];
  belt = appendToBelt(belt, a); // 1 item:  [a]
  belt = appendToBelt(belt, a); // 2 items: [-, H(a ⌢ a)]
  const aa: Bytes = keccak256(new Uint8Array(64).fill(1)); // H(a ⌢ a)
  assert.deepEqual(belt, [null, aa]);
  belt = appendToBelt(belt, a); // 3 items: [a, H(a ⌢ a)]
  const lowest: Bytes | null = belt[0];
  assert.deepEqual(lowest, a);
});

/** A history test vector: the parts of it this lesson uses. */
type HistoryVector = {
  input: { accumulate_root: string };
  pre_state: { beta: { mmr: { peaks: (string | null)[] } } };
  post_state: { beta: { history: { beefy_root: string }[]; mmr: { peaks: (string | null)[] } } };
};

const belt = (peaks: (string | null)[]): Belt => peaks.map((p) => (p === null ? null : fromHex(p)));

test("the belt after each block of the history vectors, and its super-peak", () => {
  let checked = 0;
  for (const size of ["tiny", "full"]) {
    for (const name of vectorFiles(`stf/history/${size}`)) {
      const { input, pre_state, post_state } = vectorJson(name) as HistoryVector;
      const before: Belt = belt(pre_state.beta.mmr.peaks);
      const after: Belt = appendToBelt(before, fromHex(input.accumulate_root));
      const expected: Belt = belt(post_state.beta.mmr.peaks);
      assert.deepEqual(after, expected, name);
      const newest = post_state.beta.history[post_state.beta.history.length - 1];
      const peak: string = toHex(superPeak(after));
      assert.equal(peak, newest.beefy_root, name);
      checked++;
    }
  }
  assert.equal(checked, 8);
});