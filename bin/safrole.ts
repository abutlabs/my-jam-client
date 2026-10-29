// Runs one block of Safrole from a safrole test vector, tickets and all, tells what
// happened (or why the block is refused), and checks the result against the vector.
// Usage: npm run safrole <vector.json>, e.g.
//        npm run safrole ../vectors/stf/safrole/tiny/enact-epoch-change-with-padding-1.json

import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fromHex, toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";
import { safroleError, safroleFromJson, safroleStep, ticketId } from "../src/safrole.ts";
import { TicketEnvelope } from "../src/block.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state, post_state, output } = JSON.parse(readFileSync(file, "utf8"));
const before = safroleFromJson(pre_state);
const offenders = pre_state.post_offenders.map(fromHex);
const tickets = input.extrinsic.map((t: unknown) => TicketEnvelope.fromJson(t));

const run = new Run("safrole");
const told = (what: string) => {
  console.log(what);
  run.event("told", { what });
};
const short = (hash: Uint8Array) => `${toHex(hash).slice(0, 10)}…`;
for (const t of tickets) told(`a ticket: attempt ${t.attempt}, id ${short(ticketId(t))}`);
const error = safroleError(config, before, input.slot, tickets, offenders);
if (error) {
  told(`refused: ${error} (the vector says: ${output.err})`);
  const link = await run.report();
  if (link) console.log(`reported to Grafana: ${link}`);
  process.exit(0);
}
const step = safroleStep(config, before, input.slot, fromHex(input.entropy), offenders, tickets);
const { after, epochMark, ticketsMark } = step;
told(`slot ${before.time} → ${after.time}`);
told(`η₀ stirred: ${short(before.entropy[0])} → ${short(after.entropy[0])}`);
told(`a new epoch: ${epochMark !== null}`);
const zeroed = after.validators.pending.filter((k) => k.ed25519.every((b) => b === 0)).length;
if (epochMark) told(`validators moved along one set; offenders zeroed: ${zeroed}`);
const ring = toHex(after.ringRoot) === toHex(before.ringRoot) ? "unchanged" : "new";
told(`ring root γ_Z: ${ring}, ${short(after.ringRoot)}`);
const sealers = "tickets" in after.sealers ? "the lottery's winners" : "fallback keys";
told(`sealers: ${sealers}; tickets mark: ${ticketsMark !== null}`);
const best = after.accumulator[0]; // the lowest id: the best ticket
const held = after.accumulator.length;
if (best) told(`the lottery holds ${held} ticket(s), the best ${short(best.id)}`);
const matches = isDeepStrictEqual(after, safroleFromJson(post_state));
told(`the whole state after matches the vector: ${matches}`);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);