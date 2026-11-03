import { test } from "node:test";
import assert from "node:assert/strict";
import { Block, headerHash } from "../src/block.ts";
import { TINY } from "../src/config.ts";
import { Recent, RECENT_BLOCKS } from "../src/history.ts";
import { readRecent } from "../src/state.ts";
import { checkHistory } from "./families.ts";
import { traceState, vectorFiles } from "./vectors.ts";
import type { Header } from "../src/block.ts";
import type { Bytes } from "../src/bytes.ts";
import type { RecentBlock } from "../src/history.ts";

test("β′: the last block learns its state root, the new one joins, eight are kept", () => {
  const names: string[] = [...vectorFiles("stf/history/tiny"), ...vectorFiles("stf/history/full")];
  for (const name of names) checkHistory(name);
  assert.equal(names.length, 8);
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
