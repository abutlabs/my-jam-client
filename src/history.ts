// Recent history (GP §7): the state remembers the last eight blocks, and keeps a belt of
// every accumulation output.

import type { Bytes } from "./bytes.ts";
import type { Value } from "./codec/codec.ts";
import { hash, option, record, seq, u32 } from "./codec/codec.ts";
import type { Belt } from "./belt.ts";
import { appendToBelt, superPeak } from "./belt.ts";

/** A work-package reported in a block: its hash, and the root of the segments it exports. */
export const ReportedPackage = record({
  hash: hash,
  exports_root: hash,
});
export type ReportedPackage = Value<typeof ReportedPackage>;

/** One remembered block (GP §7). */
export const RecentBlock = record({
  header_hash: hash,
  beefy_root: hash, // the belt's super-peak, just after this block
  state_root: hash, // the state root after this block: the next block fills it in
  slot: u32,
  reported: seq(ReportedPackage), // the work-packages reported in this block
});
export type RecentBlock = Value<typeof RecentBlock>;

/** β, C(3): the recent blocks, then the belt, each peak an option (GP App. D). */
export const Recent = record({
  history: seq(RecentBlock),
  belt: seq(option(hash)),
});
export type Recent = Value<typeof Recent>;

/** What a new block brings to the history (the history vectors' input). */
export const NewBlock = record({
  header_hash: hash,
  parent_state_root: hash, // H_r: the state root after the newest remembered block
  accumulate_root: hash, // the root of this block's accumulation outputs
  slot: u32,
  work_packages: seq(ReportedPackage),
});
export type NewBlock = Value<typeof NewBlock>;

/** H: how many recent blocks the state remembers. */
export const RECENT_BLOCKS = 8;

/**
 * β′ (GP §7): the newest remembered block learns its state root, the new block joins the
 * belt and the list, and the list keeps only the last eight.
 */
export function recordBlock(before: Recent, block: NewBlock): Recent {
  const last = before.history.length - 1;
  const fixed = before.history.map((b, i) =>
    i === last ? { ...b, state_root: block.parent_state_root } : b,
  );
  const belt: Belt = appendToBelt(before.belt, block.accumulate_root);
  const entry: RecentBlock = {
    header_hash: block.header_hash,
    beefy_root: superPeak(belt),
    state_root: new Uint8Array(32), // unknown yet: zeros until the next block
    slot: block.slot,
    reported: block.work_packages,
  };
  return { history: [...fixed, entry].slice(-RECENT_BLOCKS), belt };
}
