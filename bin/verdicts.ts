// Shows each verdict in a disputes test vector: whose judges voted, how they voted, whether
// every vote is really theirs, and what the verdict decides.
// Usage: npm run verdicts <vector.json>, e.g.
//        npm run verdicts ../vectors/stf/disputes/tiny/progress_with_verdicts-4.json

import { readFileSync } from "node:fs";
import { DisputesExtrinsic } from "../src/block.ts";
import { toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { judges, outcome, votesSigned } from "../src/disputes.ts";
import { Run } from "../src/obs.ts";
import { ValidatorKey } from "../src/state.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state } = JSON.parse(readFileSync(file, "utf8"));
const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
const [active, previous] = [keys(pre_state.kappa), keys(pre_state.lambda)];
const run = new Run("verdicts");
for (const verdict of DisputesExtrinsic.fromJson(input.disputes).verdicts) {
  const judgeKeys = judges(config, pre_state.tau, verdict.age, active, previous);
  const set = judgeKeys === active ? "κ" : "λ";
  const valid = verdict.votes.filter((vote) => vote.vote).length;
  const votes = verdict.votes.length;
  const signed = votesSigned(verdict, judgeKeys);
  const decided = outcome(verdict, judgeKeys.length);
  const report = `${toHex(verdict.target).slice(0, 10)}…`;
  console.log(`report ${report}: ${valid} of ${votes} say valid, judged by ${set}`);
  console.log(`  every vote signed by its judge: ${signed}. The report is ${decided}.`);
  run.event("verdict", { report: verdict.target, set, valid, votes, signed, decided });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
