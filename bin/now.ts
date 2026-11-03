// The JAM clock: prints each timeslot as it begins, and reports it to the observability
// stack. `npm run now 3` keeps time for three slots; with no number, until Ctrl+C.

import { setTimeout as sleep } from "node:timers/promises";
import { Run } from "../src/obs.ts";
import { JAM_COMMON_ERA, SLOT_SECONDS, slotAt } from "../src/time.ts";

const slots = Number(process.argv[2] ?? Infinity);
const first = slotAt(new Date());

for (let slot = first; slot < first + slots; slot++) {
  await sleep(untilSlot(slot));
  const run = new Run("now");
  console.log(`It is JAM timeslot ${slot}.`);
  run.event("slot", { slot });
  run.number("slot", slot);
  const link = await run.report();
  if (link) console.log(`reported to Grafana: ${link}`);
}

/** Milliseconds until a slot begins: 0 for the slot we're in, which has begun already. */
function untilSlot(slot: number): number {
  return Math.max(0, (JAM_COMMON_ERA + slot * SLOT_SECONDS) * 1000 - Date.now());
}
