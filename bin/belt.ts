// Grows a mountain belt one item at a time and shows its peaks after each append:
// ● a mountain, · an empty place, smallest mountain first.
// Usage: npm run belt [how many items, 16 unless you say]

import { appendToBelt, superPeak } from "../src/belt.ts";
import type { Belt } from "../src/belt.ts";
import { toHex } from "../src/bytes.ts";
import { keccak256 } from "../src/hash.ts";
import { Run } from "../src/obs.ts";

const count = Number(process.argv[2] ?? 16);
const run = new Run("belt");
let belt: Belt = [];
for (let items = 1; items <= count; items++) {
  belt = appendToBelt(belt, keccak256(new Uint8Array([items]))); // any 32 bytes will do
  const peaks = belt.map((peak) => (peak === null ? "·" : "●")).join(" ");
  const top = `${toHex(superPeak(belt)).slice(0, 10)}…`;
  console.log(`after ${String(items).padStart(3)}: ${peaks.padEnd(12)} super-peak ${top}`);
  run.event("append", { items, peaks, superPeak: superPeak(belt) });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
