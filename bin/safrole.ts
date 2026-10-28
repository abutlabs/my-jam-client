// Runs one block of Safrole from a safrole test vector (one whose block brings no tickets),
// tells what happened, and checks the result against the vector.
// Usage: npm run safrole <vector.json>, e.g.
//        npm run safrole ../vectors/stf/safrole/tiny/enact-epoch-change-with-padding-1.json

import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fromHex, toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";
import { safroleFromJson, safroleStep } from "../src/safrole.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state, post_state } = JSON.parse(readFileSync(file, "utf8"));
if (input.extrinsic.length > 0) {
  const count = input.extrinsic.length;
  console.log(`this block brings ${count} tickets: reading them needs Bandersnatch`);
  process.exit(0);
}
const before = safroleFromJson(pre_state);
const offenders = pre_state.post_offenders.map(fromHex);
const step = safroleStep(config, before, input.slot, fromHex(input.entropy), offenders);
const { after, epochMark, ticketsMark } = step;

const run = new Run("safrole");
const told = (what: string) => {
  console.log(what);
  run.event("told", { what });
};
told(`slot ${before.time} → ${after.time}`);
const short = (hash: Uint8Array) => `${toHex(hash).slice(0, 10)}…`;
told(`η₀ stirred: ${short(before.entropy[0])} → ${short(after.entropy[0])}`);
told(`a new epoch: ${epochMark !== null}`);
const zeroed = after.validators.pending.filter((k) => k.ed25519.every((b) => b === 0)).length;
if (epochMark) told(`validators moved along one set; offenders zeroed: ${zeroed}`);
const sealers = "tickets" in after.sealers ? "the lottery's winners" : "fallback keys";
told(`sealers: ${sealers}; tickets mark: ${ticketsMark !== null}`);
const matches = isDeepStrictEqual(after, safroleFromJson(post_state));
told(`the whole state after matches the vector: ${matches}`);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);