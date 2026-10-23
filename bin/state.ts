// Builds the trie of the state before a trace's block, shows where each entry lands and
// what it is, and checks the root against the one the block's header promises.
// Usage: npm run state <trace.json>, e.g.
//        npm run state ../vectors/traces/fallback/00000001.json

import { readFileSync } from "node:fs";
import type { Bytes } from "../src/bytes.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { decodeFixed } from "../src/codec/numbers.ts";
import { Run } from "../src/obs.ts";
import { stateRoot } from "../src/trie.ts";

/** The state's 16 components, by i in C(i), with their Gray Paper letters (GP App. D). */
const COMPONENTS = [
  "",
  "α, the authorizer pool",
  "ϕ, the authorizer queue",
  "β, recent blocks",
  "γ, Safrole's state",
  "ψ, past judgements",
  "η, entropy",
  "ι, the next validators",
  "κ, the validators",
  "λ, the previous validators",
  "ρ, reports awaiting availability",
  "τ, the time",
  "χ, privileged services",
  "π, statistics",
  "ω, reports ready to accumulate",
  "ξ, recently accumulated packages",
  "θ, the last accumulation outputs",
];

/** A service id from four bytes spread out with gaps, starting at byte `at` of a key. */
function serviceIn(key: Bytes, at: number): bigint {
  return decodeFixed(new Uint8Array([key[at], key[at + 2], key[at + 4], key[at + 6]]));
}

/** What a state key is: C(255, s), C(i) or C(s, h), read back from its bytes. */
function describe(key: Bytes): string {
  const zerosFrom = (i: number) => key.subarray(i).every((b) => b === 0);
  if (key[0] === 255 && zerosFrom(8)) return `C(255, ${serviceIn(key, 1)}): an account`;
  if (zerosFrom(1)) return `C(${key[0]}): ${COMPONENTS[key[0]]}`;
  return `C(${serviceIn(key, 0)}, h): something service ${serviceIn(key, 0)} keeps`;
}

const [file] = process.argv.slice(2);
const trace = JSON.parse(readFileSync(file, "utf8"));
const entries = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const run = new Run("state");
const root = stateRoot(entries, {
  event(step, fields) {
    const { depth, key, size } = fields as { depth: number; key: Bytes; size: number };
    const name = describe(key);
    run.event(step, { ...fields, name });
    const where = `depth ${String(depth).padStart(2)}  ${String(size).padStart(6)}-byte value`;
    console.log(`${where}  ${name}`);
  },
});
const promised = trace.block.header.parent_state_root;
const matches = toHex(root) === promised;
console.log(`${entries.length} entries, state root ${toHex(root)}`);
console.log(`the header promises it: ${matches}`);
run.event("root", { root, promised, matches });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);