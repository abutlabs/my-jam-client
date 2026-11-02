// The cores (GP §11): each core holds at most one guaranteed work-report while the
// validators make sure its data is available.

import { ReportGuarantee } from "./block.ts";
import type { Value } from "./codec/codec.ts";
import { option, record, seqN, u32 } from "./codec/codec.ts";
import type { Config } from "./config.ts";

/** A report on a core, waiting for its data to become available, and since which slot. */
export const PendingReport = record({
  guarantee: ReportGuarantee, // the guarantee that put it there, report and all
  registered_slot: u32,
});
export type PendingReport = Value<typeof PendingReport>;

/** ρ, C(10): one place per core, each holding a pending report or nothing. */
export function PendingReports(config: Config) {
  return seqN(option(PendingReport), config.core_count);
}