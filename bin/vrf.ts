// Reads the VRF output of real blocks' entropy sources, and stirs it into η₀: the first
// blocks of a block-import trace, each next to the η₀ the trace's next state holds.
// Usage: npm run vrf [family] [blocks], the first 5 blocks of "safrole" if not given

import { vrfOutput } from "../src/bandersnatch.ts";
import { Block } from "../src/block.ts";
import { toHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import { epochOf } from "../src/epoch.ts";
import { Run } from "../src/obs.ts";
import { nextEntropy } from "../src/safrole.ts";
import { readEntropy, readTime } from "../src/state.ts";
import { traceState } from "../test/vectors.ts";

const family = process.argv[2] ?? "safrole";
const count = Number(process.argv[3] ?? 5);
const short = (bytes: Uint8Array) => `${toHex(bytes).slice(0, 10)}…`;
const run = new Run("vrf");
for (let n = 1; n <= count; n++) {
  const { entries, block } = traceState(family, n);
  const header = Block(TINY).fromJson(block).header;
  const output = vrfOutput(header.entropy_source);
  const newEpoch = epochOf(TINY, header.slot) > epochOf(TINY, readTime(entries));
  const eta0 = nextEntropy(readEntropy(entries), output, newEpoch)[0];
  const theirs = readEntropy(traceState(family, n + 1).entries)[0]; // the state after block n
  console.log(`block ${n}, slot ${header.slot}: entropy source ${short(header.entropy_source)}`);
  console.log(`  VRF output ${short(output)}, η′₀ ${short(eta0)} (the trace: ${short(theirs)})`);
  const source = short(header.entropy_source);
  run.event("block", { n, slot: header.slot, source, output: short(output), eta0: short(eta0) });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);