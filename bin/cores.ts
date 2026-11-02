// Shows which cores lose their pending report to the verdicts of a disputes test vector.
// Usage: npm run cores <vector.json>, such as the vector that clears a core:
//   npm run cores ../vectors/stf/disputes/tiny/progress_invalidates_avail_assignments-1.json

import { readFileSync } from "node:fs";
import { DisputesExtrinsic } from "../src/block.ts";
import { toHex } from "../src/bytes.ts";
import { encode } from "../src/codec/codec.ts";
import { FULL, TINY } from "../src/config.ts";
import { PendingReports } from "../src/cores.ts";
import { clearJudged, judges, outcome } from "../src/disputes.ts";
import { blake2b256 } from "../src/hash.ts";
import { Run } from "../src/obs.ts";
import { ValidatorKey } from "../src/state.ts";
import { WorkReport } from "../src/work.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state } = JSON.parse(readFileSync(file, "utf8"));
const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
const [active, previous] = [keys(pre_state.kappa), keys(pre_state.lambda)];
const judged = DisputesExtrinsic.fromJson(input.disputes).verdicts.map((verdict) => ({
  target: verdict.target,
  outcome: outcome(verdict, judges(config, pre_state.tau, verdict.age, active, previous).length),
}));
const before = PendingReports(config).fromJson(pre_state.rho);
const after = clearJudged(before, judged);
const run = new Run("cores");
let kept = 0;
before.forEach((pending, core) => {
  if (pending === null) return;
  if (after[core] !== null) {
    kept++;
    return;
  }
  const report = blake2b256(encode(WorkReport, pending.guarantee.report));
  const verdict = judged.find((j) => toHex(j.target) === toHex(report))?.outcome;
  console.log(`core ${core}: its report ${toHex(report).slice(0, 10)}… was judged ${verdict}`);
  run.event("cleared", { core, report, verdict });
});
console.log(`${kept} of ${config.core_count} cores keep their reports`);
run.event("kept", { kept, cores: config.core_count });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);