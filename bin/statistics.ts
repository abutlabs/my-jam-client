// Moves the validators' tallies on by one block, as a statistics test vector sets it up,
// and shows what changed for whom.
// Usage: npm run statistics [vector], stats_with_epoch_change-1 (tiny) if not given

import { readFileSync } from "node:fs";
import { Extrinsic } from "../src/block.ts";
import { FULL, TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";
import { ValidatorKey } from "../src/state.ts";
import type { ValidatorStats } from "../src/statistics.ts";
import { updateValidatorStats } from "../src/statistics.ts";

const DEFAULT = "../vectors/stf/statistics/tiny/stats_with_epoch_change-1.json";
const file = process.argv[2] ?? DEFAULT;
const config = file.includes("/full/") ? FULL : TINY;
const v = JSON.parse(readFileSync(file, "utf8"));
const pre = v.pre_state;
const before = { slot: pre.slot, current: pre.vals_curr_stats, last: pre.vals_last_stats };
const validators = pre.curr_validators.map((k: unknown) => ValidatorKey.fromJson(k));
const extrinsic = Extrinsic(config).fromJson(v.input.extrinsic);
const after = updateValidatorStats(config, before, v.input.slot, v.input.author_index, extrinsic,
  validators);

const run = new Run("statistics");
const epoch = (t: number) => Math.floor(t / config.epoch_length);
const turned = epoch(v.input.slot) !== epoch(pre.slot);
console.log(`slot ${pre.slot} → ${v.input.slot}${turned ? ": a new epoch begins" : ""}`);
console.log(`author: validator ${v.input.author_index}`);
console.log("columns: blocks, tickets, preimages, preimage bytes, guarantees, assurances");
/** The tally's fields, side by side. */
const show = (s: ValidatorStats) => Object.values(s).join(" ");
for (let i = 0; i < Math.min(after.current.length, 6); i++) {
  const was = turned ? "fresh" : show(pre.vals_curr_stats[i]);
  console.log(`validator ${i}: ${was} → ${show(after.current[i])}`);
  run.event("validator", { i, before: was, after: show(after.current[i]), epoch_turned: turned });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
