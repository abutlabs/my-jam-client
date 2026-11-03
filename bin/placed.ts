// Puts the guaranteed reports of a reports test vector onto their cores, and lists the
// packages the block reports, sorted by hash.
// Usage: npm run placed <vector.json>, e.g.
//        npm run placed ../vectors/stf/reports/tiny/high_work_report_gas-1.json

import { readFileSync } from "node:fs";
import { GuaranteesExtrinsic } from "../src/block.ts";
import type { Bytes } from "../src/bytes.ts";
import { toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { PendingReports, placeReports, reportedPackages } from "../src/cores.ts";
import { Run } from "../src/obs.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state } = JSON.parse(readFileSync(file, "utf8"));
const before = PendingReports(config).fromJson(pre_state.avail_assignments);
const guarantees = GuaranteesExtrinsic.fromJson(input.guarantees);
const after = placeReports(before, guarantees, input.slot);
const short = (bytes: Bytes) => `${toHex(bytes).slice(0, 10)}…`;
const run = new Run("placed");
for (const guarantee of guarantees) {
  const core = guarantee.report.core_index;
  const was = before[core] === null ? "empty" : "taken";
  const spec = guarantee.report.package_spec;
  console.log(`core ${core} (${was}): now holds package ${short(spec.hash)}, since ${input.slot}`);
  run.event("placed", { core, was, package: spec.hash, slot: input.slot });
}
const waiting = after.filter((pending) => pending !== null).length;
console.log(`cores holding a report now: ${waiting} of ${config.core_count}`);
for (const { hash, exports_root } of reportedPackages(guarantees)) {
  console.log(`reported: package ${short(hash)}, exports root ${short(exports_root)}`);
  run.event("reported", { package: hash, exports_root });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
