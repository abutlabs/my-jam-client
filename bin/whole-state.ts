// Reads a real state whole: each of its sixteen components, by the Gray Paper's letter,
// with its size; then each service account, with how many entries it keeps.
// Usage: npm run whole-state [family] [block], before block 50 of "storage" if not given

import { encode } from "../src/codec/codec.ts";
import type { Codec } from "../src/codec/codec.ts";
import { TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";
import { StateComponents, readState } from "../src/whole-state.ts";
import { traceState } from "../test/vectors.ts";

/** Each component's Gray Paper letter, by its number. */
const LETTERS = " αϕβγψηικλρτχπωξθ";
const family = process.argv[2] ?? "storage";
const n = Number(process.argv[3] ?? 50);
const { entries } = traceState(family, n);
const state = readState(TINY, entries);
const run = new Run("state");
for (const [i, codec] of Object.entries(StateComponents(TINY))) {
  const value = state[Number(i) as keyof ReturnType<typeof StateComponents>];
  const size = encode(codec as Codec<unknown>, value).length;
  console.log(`C(${i}) ${LETTERS[Number(i)]}: ${size} bytes`);
  run.event("component", { i: Number(i), letter: LETTERS[Number(i)], size });
}
for (const [s, account] of state.accounts) {
  const items = account.items?.size ?? 0;
  console.log(`service ${s}: balance ${account.info.balance}, ${items} entries`);
  run.event("account", { s, balance: String(account.info.balance), items });
}
console.log(`${entries.length} entries in all, every one read`);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
