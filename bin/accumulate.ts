// Accumulates a test vector's block the way Part 17 does so far, and shows the queue (what
// waited, which packages went, what still waits), the rounds it took and the outputs and
// their root; then each service next to the vector: its digests, transfers in, and gas.
// Usage: npm run accumulate [vector], enqueue_and_unlock_simple-2 if not given

import { readFileSync } from "node:fs";
import { accumulateBlock, accumulationStateFromJson, outputsRoot } from "../src/accumulate.ts";
import { toHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";
import { WorkReport } from "../src/work.ts";

type Stat = {
  id: number;
  record: {
    accumulate_count: number;
    accumulate_transfer_count: number;
    accumulate_gas_used: number;
  };
};

const DEFAULT = "../vectors/stf/accumulate/tiny/enqueue_and_unlock_simple-2.json";
const vector = JSON.parse(readFileSync(process.argv[2] ?? DEFAULT, "utf8"));
const before = accumulationStateFromJson(vector.pre_state);
const reports = vector.input.reports.map((r: unknown) => WorkReport.fromJson(r));
const slot = vector.input.slot;
const { state, statistics, rounds, outputs } = accumulateBlock(TINY, before, slot, reports);

const run = new Run("accumulate");
const short = (hash: string) => hash.slice(0, 10);
const went = [...state.accumulated.at(-1)!].map(short);
console.log(`slot ${slot}: ${reports.length} new report(s), ${before.ready.flat().length} waiting`);
console.log(`accumulated: ${went.join(", ") || "nothing"}`);
console.log(`still waiting: ${state.ready.flat().length}`);
console.log(`rounds: ${rounds.length}, taking ${rounds.join(", then ")} report(s)`);
console.log(`assigners: ${before.privileges.assign} → ${state.privileges.assign}`);
const yields = outputs.map((o) => `service ${o.service} yielded ${short(toHex(o.hash))}`);
const root = short(toHex(outputsRoot(outputs)));
const theirs = short(vector.output.ok); // the root the vector expects
console.log(`outputs: ${yields.join(", ") || "none"}; root ${root} (vector: ${theirs})`);
run.event("block", {
  slot,
  went: went.join(", "),
  waiting: state.ready.flat().length,
  assigners: `${before.privileges.assign} → ${state.privileges.assign}`,
  rounds: rounds.join(", "),
  outputs: outputs.length,
  root,
});
for (const [s, { count, transfers, gasUsed }] of statistics) {
  const theirs = (vector.post_state.statistics as Stat[]).find((x) => x.id === s)?.record;
  console.log(`service ${s}: ${count} digest(s), ${transfers} transfer(s), ${gasUsed} gas`);
  const said = `${theirs?.accumulate_count} digest(s), ${theirs?.accumulate_transfer_count} ` +
    `transfer(s), ${theirs?.accumulate_gas_used} gas`;
  console.log(`  the vector says: ${said}`);
  const expected = theirs?.accumulate_gas_used;
  run.event("service", { s, count, transfers, used: Number(gasUsed), expected });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
