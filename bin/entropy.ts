// Shows how one block changes η, from a safrole test vector: the accumulator stirred with
// the block's VRF output, and the history moving along if a new epoch begins.
// Usage: npm run entropy <vector.json>, e.g.
//        npm run entropy ../vectors/stf/safrole/tiny/enact-epoch-change-with-no-tickets-4.json

import { readFileSync } from "node:fs";
import { fromHex, toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { epochOf } from "../src/epoch.ts";
import { Run } from "../src/obs.ts";
import { nextEntropy } from "../src/safrole.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state, post_state } = JSON.parse(readFileSync(file, "utf8"));
const newEpoch = epochOf(config, input.slot) > epochOf(config, pre_state.tau);
const before: string[] = pre_state.eta;
const after = nextEntropy(before.map(fromHex), fromHex(input.entropy), newEpoch).map(toHex);
const short = (hash: string) => `${hash.slice(0, 18)}…`;
const run = new Run("entropy");
console.log(`slot ${pre_state.tau} → ${input.slot}${newEpoch ? ": a new epoch" : ""}`);
console.log(`VRF output ${short(input.entropy)}`);
after.forEach((hash, index) => {
  console.log(`η${index}  ${short(before[index])}  →  ${short(hash)}`);
  run.event("eta", { index, before: before[index], after: hash });
});
const matches = after.every((hash, index) => hash === post_state.eta[index]);
console.log(`η′ matches the vector: ${matches}`);
run.event("result", { slot: input.slot, newEpoch, matches });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);