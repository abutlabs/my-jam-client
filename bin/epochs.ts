// Walks the 100 blocks of the tiny "safrole" trace and shows where each new epoch begins:
// the header carries an epoch mark, and the entropy history moves along one.

import { readFileSync } from "node:fs";
import { Block } from "../src/block.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import { epochOf, phaseOf } from "../src/epoch.ts";
import { Run } from "../src/obs.ts";
import { readEntropy, readTime } from "../src/state.ts";

const run = new Run("epochs");
let epochs = 0;
for (let n = 1; n <= 100; n++) {
  const file = `../vectors/traces/safrole/${String(n).padStart(8, "0")}.json`;
  const trace = JSON.parse(readFileSync(file, "utf8"));
  const entries = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
    key: fromHex(e.key),
    value: fromHex(e.value),
  }));
  const { slot, epoch_mark } = Block(TINY).fromJson(trace.block).header;
  const epoch = epochOf(TINY, slot);
  const newEpoch = epoch > epochOf(TINY, readTime(entries));
  const mark = epoch_mark !== null;
  run.event("block", { slot, epoch, phase: phaseOf(TINY, slot), newEpoch, mark });
  if (!newEpoch) continue;
  epochs++;
  const eta0 = toHex(readEntropy(entries)[0]).slice(0, 18); // η₀, shortened
  console.log(`slot ${slot}: epoch ${epoch} begins. Epoch mark: ${mark}. η₁ is now ${eta0}…`);
}
console.log(`${epochs} new epochs in 100 blocks.`);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);