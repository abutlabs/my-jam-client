// Counts, core by core, how many validators of an assurances test vector hold each pending
// report's data, and which reports become available.
// Usage: npm run available <vector.json>, e.g.
//        npm run available ../vectors/stf/assurances/tiny/some_assurances-1.json

import { readFileSync } from "node:fs";
import { assuredCount } from "../src/assurances.ts";
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
const run = new Run("available");
let available = 0;
cores.forEach((pending, core) => {
  if (pending === null) return;
  const assured = assuredCount(assurances, core);
  const now = 3 * assured > 2 * validators;
  if (now) available++;
  const verdict = now ? "available!" : "still waiting";
  const where = `core ${String(core).padStart(3)}`;
  console.log(`${where}: ${assured} of ${validators} hold its data: ${verdict}`);
  run.event("core", { core, assured, validators, available: now });
});
console.log(`reports that became available: ${available}`);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
