// Shows what happens to each core's pending report in an assurances test vector: it
// became available, it timed out, the validator set resized, or it stays.
// Usage: npm run release <vector.json>, for example:
//   npm run release ../vectors/stf/assurances/tiny/no_assurances_with_stale_report-1.json

import { readFileSync } from "node:fs";
import { AVAILABILITY_TIMEOUT, availableCores } from "../src/assurances.ts";
import { Assurance } from "../src/block.ts";
import { FULL, TINY } from "../src/config.ts";
import { PendingReports } from "../src/cores.ts";
import { Run } from "../src/obs.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state } = JSON.parse(readFileSync(file, "utf8"));
const cores = PendingReports(config).fromJson(pre_state.avail_assignments);
const assurances = input.assurances.map((a: unknown) => Assurance(config).fromJson(a));
const validators = pre_state.curr_validators.length;
const available = availableCores(cores, assurances, validators);
const next = pre_state.post_validators.length; // |κ′|
const resized = validators !== next;
const run = new Run("release");
cores.forEach((pending, core) => {
  if (pending === null) return;
  const since = pending.registered_slot;
  let fate = "stays";
  if (available.includes(core)) fate = "became available";
  else if (input.slot >= since + AVAILABILITY_TIMEOUT) fate = `timed out (waiting since ${since})`;
  else if (resized) fate = `cleared: κ goes from ${validators} to ${next}`;
  console.log(`core ${String(core).padStart(3)} at slot ${input.slot}: ${fate}`);
  run.event("core", { core, slot: input.slot, since, fate });
});
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
