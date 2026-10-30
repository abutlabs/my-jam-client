// Reads β from the state before a trace's block: the blocks the chain remembers, each with
// the belt's super-peak as it stood after that block (its beefy_root), and the one belt,
// its super-peak folded live and checked against the newest block's.
// Usage: npm run history <trace.json>, e.g.
//        npm run history ../vectors/traces/preimages/00000050.json

import { readFileSync } from "node:fs";
import type { Bytes } from "../src/bytes.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { superPeak } from "../src/belt.ts";
import { Run } from "../src/obs.ts";
import { readRecent } from "../src/state.ts";

const [file] = process.argv.slice(2);
const trace = JSON.parse(readFileSync(file, "utf8"));
const entries = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const { history, belt } = readRecent(entries);
const short = (bytes: Bytes) => `${toHex(bytes).slice(0, 10)}…`;
/** The belt's shape after n items: n in binary, smallest mountain first. */
const dot = (bit: string) => (bit === "1" ? "●" : "·");
const dots = (n: number) => [...n.toString(2)].reverse().map(dot).join(" ");
const items = belt.reduce((n: number, peak, i) => (peak === null ? n : n + 2 ** i), 0);
const run = new Run("history");
for (const [i, { slot, header_hash, state_root, beefy_root, reported }] of history.entries()) {
  const onBelt = items - (history.length - 1 - i); // every block appended one item
  const roots = `header ${short(header_hash)}  state root ${short(state_root)}`;
  const line = `slot ${String(slot).padStart(3)}  ${roots}  beefy ${short(beefy_root)}`;
  console.log(`${line}  reported: ${reported.length}  belt ${dots(onBelt)}`);
  const counted = { reported: reported.length, belt: dots(onBelt) };
  run.event("block", { slot, header_hash, state_root, beefy_root, ...counted });
}
const peaks = belt.map((peak) => (peak === null ? "·" : "●")).join(" ");
const top = superPeak(belt);
const newest = history[history.length - 1];
const same = toHex(top) === toHex(newest.beefy_root);
const agrees = same ? "the newest block's beefy ✓" : "NOT the newest block's beefy ✗";
console.log(`the belt: ${peaks}`);
console.log(`its super-peak, folded live: ${short(top)} — ${agrees}`);
run.event("belt", { peaks, superPeak: top });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
