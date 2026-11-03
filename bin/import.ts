// Imports a whole block-import trace, block after block, each into the state your client
// made from the one before: from the trace's first state on, nothing else is taken from
// the trace but its blocks. Each state root is shown next to the trace's.
// Usage: npm run import [family], "storage_light" if not given

import { Block } from "../src/block.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import { importBlock } from "../src/import.ts";
import { Run } from "../src/obs.ts";
import type { KeyValue } from "../src/trie.ts";
import { stateRoot } from "../src/trie.ts";
import { vectorJson } from "../test/vectors.ts";

type TraceStep = {
  pre_state: { keyvals: { key: string; value: string }[] };
  block: unknown;
  post_state: { state_root: string };
};

const family = process.argv[2] ?? "storage_light";
const step = (n: number) =>
  vectorJson(`traces/${family}/${String(n).padStart(8, "0")}.json`) as TraceStep;
let state: KeyValue[] = step(1).pre_state.keyvals.map((e) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const run = new Run("import");
let matched = 0;
for (let n = 1; n <= 100; n++) {
  const { block, post_state } = step(n);
  const header = Block(TINY).fromJson(block).header;
  const result = importBlock(TINY, state, Block(TINY).fromJson(block));
  if (!("error" in result)) state = result; // a refused block leaves the state as it was
  const root = toHex(stateRoot(state));
  const same = root === post_state.state_root;
  if (same) matched++;
  const what = "error" in result ? `refused: ${result.error}` : "imported";
  const compared = `root ${root.slice(0, 10)}… ${same ? "=" : "≠"} the trace's`;
  console.log(`block ${n}, slot ${header.slot}: ${what}; ${compared}`);
  run.event("block", { n, slot: header.slot, what, root: root.slice(0, 10), same });
}
console.log(`${matched} of 100 state roots as the trace's`);
run.event("done", { family, matched });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
