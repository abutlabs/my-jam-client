// Shows a lottery's result from a safrole test vector: if this block closes a full lottery,
// which slot of the next epoch each winning ticket will seal, outside in.
// Usage: npm run lottery <vector.json>, e.g.
//        npm run lottery ../vectors/stf/safrole/tiny/publish-tickets-with-mark-4.json

import { readFileSync } from "node:fs";
import { TicketBody } from "../src/block.ts";
import { toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";
import { ticketsMark } from "../src/safrole.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state } = JSON.parse(readFileSync(file, "utf8"));
const accumulator = pre_state.gamma_a.map((ticket: unknown) => TicketBody.fromJson(ticket));
const mark = ticketsMark(config, pre_state.tau, input.slot, accumulator);
const run = new Run("lottery");
const closesAt = config.epoch_tail_start; // Y
console.log(`slot ${pre_state.tau} → ${input.slot}, the lottery closes at phase ${closesAt}`);
const verdict = mark ? "a tickets mark" : "no mark";
console.log(`${accumulator.length} of ${config.epoch_length} tickets: ${verdict}`);
run.event("lottery", { before: pre_state.tau, after: input.slot, mark: mark !== null });
mark?.forEach((ticket, phase) => {
  const rank = accumulator.indexOf(ticket); // 0: the best ticket, with the lowest id
  const id = `${toHex(ticket.id).slice(0, 10)}…`;
  console.log(`slot ${String(phase).padStart(3)} of the next epoch: ticket ${rank}, ${id}`);
  run.event("seat", { phase, rank, id: ticket.id });
});
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
