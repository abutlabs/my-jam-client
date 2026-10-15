// Work: what services ask the cores to compute (GP §11, §14).

import type { Value } from "./codec/codec.ts";
import { blob, hash, record, seq, u16, u32, u64 } from "./codec/codec.ts";

/** The refinement context (GP §11): the chain as a work-package saw it. */
export const RefineContext = record({
  anchor: hash, // a recent block's header hash
  anchor_slot: u32,
  state_root: hash, // the anchor's posterior state root
  beefy_root: hash, // the anchor's accumulation-output super-peak
  lookup_anchor: hash, // the block whose state refine reads preimages from
  lookup_anchor_slot: u32,
  lookup_anchor_state_root: hash,
  prerequisites: seq(hash), // work-packages to accumulate first
});
export type RefineContext = Value<typeof RefineContext>;

/** A data segment to import: which set of segments (by its root), and which one in it. */
export const ImportSpec = record({
  tree_root: hash,
  index: u16,
});
export type ImportSpec = Value<typeof ImportSpec>;

/** Extrinsic data a work item carries: its hash and length. */
export const ExtrinsicSpec = record({
  hash: hash,
  len: u32,
});
export type ExtrinsicSpec = Value<typeof ExtrinsicSpec>;

/** A work item (GP §14): one job in a work-package, for one service. */
export const WorkItem = record({
  service: u32,
  code_hash: hash,
  refine_gas_limit: u64,
  accumulate_gas_limit: u64,
  export_count: u16,
  payload: blob,
  import_segments: seq(ImportSpec),
  extrinsic: seq(ExtrinsicSpec),
});
export type WorkItem = Value<typeof WorkItem>;