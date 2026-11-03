// Checks the seal and entropy source of real blocks: the first blocks of a block-import
// trace, each against the author's key, the slot's entry in γ′_S, and η′₃.
// Usage: npm run seals [family] [from] [to], blocks 46 to 50 of "safrole" if not given

import { Block } from "../src/block.ts";
import { toHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";
import { sealError } from "../src/safrole.ts";
import { readEntropy, readSafroleState, readValidators } from "../src/state.ts";
import { traceState } from "../test/vectors.ts";

const family = process.argv[2] ?? "safrole";
const [from, to] = [Number(process.argv[3] ?? 46), Number(process.argv[4] ?? 50)];
const run = new Run("seals");
for (let n = from; n <= to; n++) {
  const header = Block(TINY).fromJson(traceState(family, n).block).header;
  const after = traceState(family, n + 1).entries; // the state after block n
  const author = readValidators(after)[header.author_index].bandersnatch;
  const { sealers } = readSafroleState(TINY, after);
  const error = sealError(TINY, header, author, sealers, readEntropy(after)[3]);
  const by = "tickets" in sealers ? "a winning ticket" : "a fallback key";
  const verdict = error ?? "seal and entropy source check out";
  const who = `validator ${header.author_index} (${toHex(author).slice(0, 10)}…)`;
  console.log(`block ${n}, slot ${header.slot}: ${who}, by ${by}: ${verdict}`);
  run.event("block", { n, slot: header.slot, author: header.author_index, by, verdict });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
