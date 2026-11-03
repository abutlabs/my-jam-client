// Shows who guarantees which core in a reports test vector, this rotation and the last,
// and checks each guarantee's signers against the assignment it answers to.
// Usage: npm run guarantors <vector.json>, e.g.
//        npm run guarantors ../vectors/stf/reports/tiny/report_prev_rotation-1.json

import { readFileSync } from "node:fs";
import { GuaranteesExtrinsic } from "../src/block.ts";
import { fromHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import type { Assignment } from "../src/guarantors.ts";
import { assignmentFor, guarantorAssignments } from "../src/guarantors.ts";
import { Run } from "../src/obs.ts";
import { ValidatorKey } from "../src/state.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state } = JSON.parse(readFileSync(file, "utf8"));
const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
const assignments = guarantorAssignments(
  config,
  input.slot,
  pre_state.entropy.map(fromHex),
  keys(pre_state.curr_validators),
  keys(pre_state.prev_validators),
  pre_state.offenders.map(fromHex),
);
const run = new Run("guarantors");

/** Each core's guarantors in an assignment, as validator indices. */
function byCore(assignment: Assignment): string {
  const cores = [...new Set(assignment.cores)].sort((a, b) => a - b);
  const seats = (core: number) => assignment.cores.flatMap((c, v) => (c === core ? [v] : []));
  return cores.map((core) => `core ${core}: ${seats(core).join(" ")}`).join(" | ");
}
console.log(`slot ${input.slot}, rotation ${Math.floor(input.slot / config.rotation_period)}`);
console.log(`  this rotation: ${byCore(assignments.current)}`);
console.log(`  the last one:  ${byCore(assignments.last)}`);
for (const guarantee of GuaranteesExtrinsic.fromJson(input.guarantees)) {
  const assignment = assignmentFor(config, input.slot, guarantee.slot, assignments);
  const which = assignment === assignments.current ? "this rotation" : "the last rotation";
  const signers = guarantee.signatures.map((s) => s.validator_index);
  const core = guarantee.report.core_index;
  const assigned = signers.every((v) => assignment.cores[v] === core);
  console.log(`guarantee for core ${core}, made at slot ${guarantee.slot} (${which}):`);
  console.log(`  signed by ${signers.join(", ")}: all assigned to core ${core}? ${assigned}`);
  const made = guarantee.slot;
  run.event("guarantee", { core, made, which, signers: signers.join(" "), assigned });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
