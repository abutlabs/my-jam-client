// Shows the four validator sets before and after a block, from a safrole test vector, each
// validator by the first four hex digits of its Ed25519 key.
// Usage: npm run rotation <vector.json>, e.g.
//        npm run rotation ../vectors/stf/safrole/tiny/enact-epoch-change-with-padding-1.json

import { readFileSync } from "node:fs";
import { fromHex, toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { epochOf } from "../src/epoch.ts";
import { Run } from "../src/obs.ts";
import type { ValidatorSets } from "../src/safrole.ts";
import { rotateValidators } from "../src/safrole.ts";
import { ValidatorKey } from "../src/state.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state } = JSON.parse(readFileSync(file, "utf8"));
const read = (keys: unknown[]) => keys.map((key) => ValidatorKey.fromJson(key));
const before: ValidatorSets = {
  staging: read(pre_state.iota),
  pending: read(pre_state.gamma_k),
  active: read(pre_state.kappa),
  previous: read(pre_state.lambda),
};
const offenders = pre_state.post_offenders.map(fromHex);
const newEpoch = epochOf(config, input.slot) > epochOf(config, pre_state.tau);
const after = newEpoch ? rotateValidators(before, offenders) : before;

/** A set of keys, each as the first four hex digits of its Ed25519 key. */
const short = (keys: ValidatorKey[]) => keys.map((k) => toHex(k.ed25519).slice(2, 6)).join(" ");

const run = new Run("rotation");
console.log(`slot ${pre_state.tau} → ${input.slot}${newEpoch ? ": a new epoch" : ""}`);
for (const set of ["staging", "pending", "active", "previous"] as const) {
  console.log(`${set.padEnd(8)}  ${short(before[set])}  →  ${short(after[set])}`);
  run.event("set", { set, before: short(before[set]), after: short(after[set]) });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);