// Prints the JAM timeslot it is right now, and reports it to the observability stack.

import { Run } from "../src/obs.ts";
import { slotAt } from "../src/time.ts";

const run = new Run("now");
const slot = slotAt(new Date());
console.log(`It is JAM timeslot ${slot}.`);
run.event("slot", { slot });
run.number("slot", slot);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);