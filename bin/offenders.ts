// Shows the offenders in a disputes test vector: each culprit (a guarantor of a bad report)
// and each fault (a vote against the verdict), and whether the evidence is real.
// Usage: npm run offenders <vector.json>, e.g.
//        npm run offenders ../vectors/stf/disputes/tiny/progress_with_verdicts-4.json

import { readFileSync } from "node:fs";
import { DisputesExtrinsic } from "../src/block.ts";
import type { Bytes } from "../src/bytes.ts";
import { toHex } from "../src/bytes.ts";
import { culpritSigned, faultSigned, offendersMark } from "../src/disputes.ts";
import { Run } from "../src/obs.ts";

const [file] = process.argv.slice(2);
const { input } = JSON.parse(readFileSync(file, "utf8"));
const disputes = DisputesExtrinsic.fromJson(input.disputes);
const short = (bytes: Bytes) => `${toHex(bytes).slice(0, 10)}…`;
const run = new Run("offenders");
for (const culprit of disputes.culprits) {
  const signed = culpritSigned(culprit);
  console.log(`culprit ${short(culprit.key)}: guaranteed report ${short(culprit.target)}`);
  console.log(`  the guarantee is really theirs: ${signed}`);
  run.event("culprit", { key: culprit.key, report: culprit.target, signed });
}
for (const fault of disputes.faults) {
  const signed = faultSigned(fault);
  const said = fault.vote ? "valid" : "invalid";
  console.log(`fault ${short(fault.key)}: voted ${said} on report ${short(fault.target)}`);
  console.log(`  the vote is really theirs: ${signed}`);
  run.event("fault", { key: fault.key, report: fault.target, said, signed });
}
console.log(`offenders mark: ${offendersMark(disputes).map(short).join(", ") || "none"}`);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);