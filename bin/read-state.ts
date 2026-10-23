// Reads three components of the state before a trace's block: τ, η and κ.
// Usage: npm run read-state <trace.json>, e.g.
//        npm run read-state ../vectors/traces/safrole/00000012.json

import { readFileSync } from "node:fs";
import { fromHex, toHex } from "../src/bytes.ts";
import { Run } from "../src/obs.ts";
import { readEntropy, readTime, readValidators } from "../src/state.ts";

const [file] = process.argv.slice(2);
const trace = JSON.parse(readFileSync(file, "utf8"));
const entries = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const run = new Run("read-state");

const slot = readTime(entries);
console.log(`τ, the time: slot ${slot}`);
run.event("time", { slot });

readEntropy(entries).forEach((hash, index) => {
  console.log(`η${index}: ${toHex(hash)}`);
  run.event("entropy", { index, hash });
});

readValidators(entries).forEach((v, index) => {
  console.log(`κ${index}: ed25519 ${toHex(v.ed25519)}`);
  run.event("validator", { index, ed25519: v.ed25519, bandersnatch: v.bandersnatch });
});

const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);