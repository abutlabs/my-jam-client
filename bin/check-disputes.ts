// Checks the disputes of every disputes test vector of one size against the rules (the
// verdicts', then the culprits' and faults'), and shows each verdict next to the vector's:
// accepted, or the first rule broken.
// Usage: npm run check-disputes [tiny or full], tiny if not given

import { readdirSync, readFileSync } from "node:fs";
import { DisputesExtrinsic } from "../src/block.ts";
import { FULL, TINY } from "../src/config.ts";
import { disputesError, PastJudgements } from "../src/disputes.ts";
import { Run } from "../src/obs.ts";
import { ValidatorKey } from "../src/state.ts";

const config = process.argv[2] === "full" ? FULL : TINY;
const dir = `../vectors/stf/disputes/${config.name}`;
const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
const run = new Run("dispute-check");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const { input, pre_state, output } = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  const disputes = DisputesExtrinsic.fromJson(input.disputes);
  const before = PastJudgements.fromJson(pre_state.psi);
  const [active, previous] = [keys(pre_state.kappa), keys(pre_state.lambda)];
  const error = disputesError(config, disputes, before, pre_state.tau, active, previous);
  const ours = error ?? "accepted";
  const theirs = output.err ?? "accepted";
  const name = file.replace(".json", "");
  console.log(`${name}: ${ours}${ours === theirs ? "" : ` (the vector says ${theirs})`}`);
  run.event("vector", { name, ours, theirs, agree: ours === theirs });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
