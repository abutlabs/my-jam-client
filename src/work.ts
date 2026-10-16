// Work: what services ask the cores to compute (GP §11, §14).

import type { Value, Codec } from "./codec/codec.ts";
import { blob, hash, record, seq, u16, u32, u64, natural, natural32 } from "./codec/codec.ts";
import type { Bytes } from "./bytes.ts";
import { fromHex } from "./bytes.ts";

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

/**
 * A work-package (GP §14): up to 16 work items for one core, the context they were built
 * against, and what the authorizer needs to let them in.
 */
export const WorkPackage = record({
  auth_code_host: u32, // the service whose storage holds the authorizer's code
  auth_code_hash: hash, // which code: the authorizer
  context: RefineContext,
  authorization: blob, // the token the authorizer checks
  authorizer_config: blob, // the authorizer's settings
  items: seq(WorkItem),
});
export type WorkPackage = Value<typeof WorkPackage>;

/** The six ways refine can fail, in tag order 1 to 6 (GP §11 and Appendix C, O). */
const ERRORS = [
  "out_of_gas", "panic", "bad_exports", "output_oversize", "bad_code", "code_oversize",
] as const;
export type WorkError = (typeof ERRORS)[number];

/** What refine produced: its output, or why there is none. */
export type WorkResult = { ok: Bytes } | { error: WorkError };

/** O(result): tag 0 and the output as a blob, or just the error's tag. */
export const WorkResult: Codec<WorkResult> = {
  encode: (w, result) => {
    if ("ok" in result) {
      w.natural(0n);
      blob.encode(w, result.ok);
    } else {
      w.natural(BigInt(ERRORS.indexOf(result.error) + 1));
    }
  },
  decode: (r) => {
    const tag = Number(r.natural());
    return tag === 0 ? { ok: blob.decode(r) } : { error: ERRORS[tag - 1] };
  },
  fromJson: (json) => {
    const [name, value] = Object.entries(json as object)[0];
    return name === "ok" ? { ok: fromHex(value as string) } : { error: name as WorkError };
  },
};

/** How hard refine worked: gas used, segments imported and exported, extrinsics read. */
export const RefineLoad = record({
  gas_used: natural,
  imports: natural32,
  extrinsic_count: natural32,
  extrinsic_size: natural32,
  exports: natural32,
});
export type RefineLoad = Value<typeof RefineLoad>;

/** A work digest (GP §11): one work item's result, as a work-report carries it. */
export const WorkDigest = record({
  service_id: u32,
  code_hash: hash,
  payload_hash: hash,
  accumulate_gas: u64, // the gas this result may use when it is accumulated
  result: WorkResult,
  refine_load: RefineLoad,
});
export type WorkDigest = Value<typeof WorkDigest>;

/** An availability specification (GP §11): how to find a package's data again. */
export const AvailabilitySpec = record({
  hash: hash, // the work-package's hash
  length: u32, // the size of its bundle, the package plus everything needed to re-run it
  erasure_root: hash, // the root of its erasure-coded chunks
  erasure_shards: u16, // how many chunks: one per validator
  exports_root: hash, // the root of the segments it exported
  exports_count: u16,
});
export type AvailabilitySpec = Value<typeof AvailabilitySpec>;

/** A segment-root lookup entry: a work-package's hash and the root of its segments. */
export const SegmentRootLookupItem = record({
  work_package_hash: hash,
  segment_tree_root: hash,
});
export type SegmentRootLookupItem = Value<typeof SegmentRootLookupItem>;

/** A work-report (GP §11): what a core sends back for one work-package. */
export const WorkReport = record({
  package_spec: AvailabilitySpec,
  context: RefineContext,
  core_index: natural32,
  authorizer_hash: hash,
  auth_gas_used: natural,
  auth_output: blob,
  segment_root_lookup: seq(SegmentRootLookupItem),
  results: seq(WorkDigest),
});
export type WorkReport = Value<typeof WorkReport>;