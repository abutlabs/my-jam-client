// The cores (GP §11): each core holds at most one guaranteed work-report while the
// validators make sure its data is available.

import { ReportGuarantee } from "./block.ts";
import type { Value } from "./codec/codec.ts";
import { option, record, seqN, u32 } from "./codec/codec.ts";
import type { Config } from "./config.ts";
import { toHex } from "./bytes.ts";
import type { ReportedPackage } from "./history.ts";

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

/** ρ′ (GP §11): each guaranteed report takes its core, registered at this block's slot. */
export function placeReports(
  cores: (PendingReport | null)[],
  guarantees: ReportGuarantee[],
  slot: number, // τ′
): (PendingReport | null)[] {
  const after = [...cores];
  for (const guarantee of guarantees) {
    after[guarantee.report.core_index] = { guarantee, registered_slot: slot };
  }
  return after;
}

/** The packages a block reports: each one's hash and exports root, sorted by hash. */
export function reportedPackages(guarantees: ReportGuarantee[]): ReportedPackage[] {
  const packages = guarantees.map(({ report }) => ({
    hash: report.package_spec.hash,
    exports_root: report.package_spec.exports_root,
  }));
  return packages.sort((a, b) => toHex(a.hash).localeCompare(toHex(b.hash))); // a dictionary
}
