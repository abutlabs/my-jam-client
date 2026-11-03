// Checks the signatures on every guarantee of a reports test vector and lists the
// reporters: everyone who signed, once each.
// Usage: npm run reporters <vector.json>, e.g.
//        npm run reporters ../vectors/stf/reports/tiny/multiple_reports-1.json

import { readFileSync } from "node:fs";
import { GuaranteesExtrinsic } from "../src/block.ts";
import type { Bytes } from "../src/bytes.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { assignmentFor, guaranteeSigned, guarantorAssignments } from "../src/guarantors.ts";
import { reporters, signerKeys } from "../src/guarantors.ts";
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
const short = (bytes: Bytes) => `${toHex(bytes).slice(0, 10)}…`;
const run = new Run("reporters");
const everyone: Bytes[] = [];
for (const guarantee of GuaranteesExtrinsic.fromJson(input.guarantees)) {
  const assignment = assignmentFor(config, input.slot, guarantee.slot, assignments);
  const signers = signerKeys(guarantee, assignment.keys);
  const signed = guaranteeSigned(guarantee, assignment.keys);
  everyone.push(...signers);
  const core = guarantee.report.core_index;
  console.log(`core ${core}: signed by ${signers.map(short).join(", ")}; all real: ${signed}`);
  run.event("guarantee", { core, signers: signers.map(short).join(" "), signed });
}
const G = reporters(everyone);
console.log(`𝐆, the reporters: ${G.length} of ${everyone.length} signatures' keys`);
for (const key of G) console.log(`  ${toHex(key)}`);
run.event("reporters", { count: G.length, signatures: everyone.length });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
