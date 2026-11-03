// Checks the assurances of every assurances test vector of one size against the rules, and
// shows each verdict next to the vector's: accepted, or the rule it breaks.
// Usage: npm run check-assurances [tiny or full], tiny if not given

import { readdirSync, readFileSync } from "node:fs";
import { assuranceError } from "../src/assurances.ts";
import { Assurance } from "../src/block.ts";
import { fromHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { PendingReports } from "../src/cores.ts";
import { Run } from "../src/obs.ts";

const config = process.argv[2] === "full" ? FULL : TINY;
const dir = `../vectors/stf/assurances/${config.name}`;
const run = new Run("assurance-check");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const { input, pre_state, output } = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  const assurances = input.assurances.map((a: unknown) => Assurance(config).fromJson(a));
  const keys = pre_state.curr_validators.map((k: { ed25519: string }) => fromHex(k.ed25519));
  const cores = PendingReports(config).fromJson(pre_state.avail_assignments);
  const ours = assuranceError(assurances, fromHex(input.parent), keys, cores) ?? "accepted";
  const theirs = output.err ?? "accepted";
  const name = file.replace(".json", "");
  console.log(`${name}: ${ours}${ours === theirs ? "" : ` (the vector says ${theirs})`}`);
  run.event("vector", { name, ours, theirs, agree: ours === theirs });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
