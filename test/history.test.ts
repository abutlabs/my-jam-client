import { test } from "node:test";
import assert from "node:assert/strict";
import { Block, headerHash } from "../src/block.ts";
import { TINY } from "../src/config.ts";
import { NewBlock, Recent, RECENT_BLOCKS, recordBlock } from "../src/history.ts";
import { readRecent } from "../src/state.ts";
import { traceState, vectorFiles, vectorJson } from "./vectors.ts";
import type { Header } from "../src/block.ts";
import type { Bytes } from "../src/bytes.ts";
import type { RecentBlock } from "../src/history.ts";

/** A history vector's β, as your client's Recent. */
function recent(beta: { history: unknown[]; mmr: { peaks: unknown[] } }): Recent {
  return Recent.fromJson({ history: beta.history, belt: beta.mmr.peaks });
}

test("β′: the last block learns its state root, the new one joins, eight are kept", () => {
  let checked = 0;
  for (const size of ["tiny", "full"]) {
    for (const name of vectorFiles(`stf/history/${size}`)) {
      const { input, pre_state, post_state } = vectorJson(name) as {
        input: unknown;
        pre_state: { beta: { history: unknown[]; mmr: { peaks: unknown[] } } };
        post_state: { beta: { history: unknown[]; mmr: { peaks: unknown[] } } };
      };
      const before: Recent = recent(pre_state.beta);
      const after: Recent = recordBlock(before, NewBlock.fromJson(input));
      const expected: Recent = recent(post_state.beta);
      assert.deepEqual(after, expected, name);
      checked++;
    }
  }
  assert.equal(checked, 8);
});

test("β in real states: the newest block remembered is the block before", () => {
  for (let n = 2; n <= 100; n++) {
    const { history }: Recent = readRecent(traceState("fallback", n).entries);
    const before: Header = Block(TINY).fromJson(traceState("fallback", n - 1).block).header;
    const newest: RecentBlock = history[history.length - 1];
    const beforeHash: Bytes = headerHash(TINY, before);
    assert.deepEqual(newest.header_hash, beforeHash, `block ${n}`);
    assert.deepEqual(newest.state_root, new Uint8Array(32)); // not known yet
    const previous: RecentBlock = history[history.length - 2];
    assert.deepEqual(previous.state_root, before.parent_state_root);
    const kept: number = Math.min(n, RECENT_BLOCKS); // genesis counts too
    assert.equal(history.length, kept);
  }
});