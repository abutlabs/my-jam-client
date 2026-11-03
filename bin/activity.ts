// One block's core and service activity, from a reports test vector (new work taken on) or
// an assurances one (data now available), and what each core and service did.
// Usage: npm run activity [vector], multiple_reports-1 (tiny) if not given

import { readFileSync } from "node:fs";
import { Assurance } from "../src/block.ts";
import { FULL, TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";
import { coreStats, serviceStats } from "../src/statistics.ts";
import { WorkReport } from "../src/work.ts";

const DEFAULT = "../vectors/stf/reports/tiny/multiple_reports-1.json";
const file = process.argv[2] ?? DEFAULT;
const config = file.includes("/full/") ? FULL : TINY;
const v = JSON.parse(readFileSync(file, "utf8"));
let incoming: WorkReport[] = []; // I
let available: WorkReport[] = []; // R
let assurances: Assurance[] = [];
if (file.includes("/assurances/")) {
  // a block of assurances: some reports' data is now available
  available = v.output.ok.reported.map((r: unknown) => WorkReport.fromJson(r));
  assurances = v.input.assurances.map((a: unknown) => Assurance(config).fromJson(a));
} else {
  // a block of guarantees: new reports, new work for their cores
  incoming = v.input.guarantees.map((g: { report: unknown }) => WorkReport.fromJson(g.report));
}
const cores = coreStats(config, incoming, available, assurances);
const services = serviceStats(incoming, [], new Map());

const run = new Run("activity");
/** A tally's fields that aren't zero, by name: the ones worth reading. */
const busy = (tally: object) =>
  Object.entries(tally).filter(([, n]) => Number(n) !== 0).map(([k, n]) => `${k} ${n}`).join(", ");
const show = (who: string, tally: object) => {
  const did = busy(tally) || "nothing";
  console.log(`${who}: ${did}`);
  run.event("tally", { who, did });
};
cores.forEach((tally, c) => show(`core ${c}`, tally));
for (const [s, tally] of services) show(`service ${s}`, tally);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
