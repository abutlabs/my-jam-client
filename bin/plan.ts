// Prints the plan of a block import: the Gray Paper's steps in waves, each with what it's
// made from and the lesson that builds it.
// Usage: npm run plan

import { STEPS, waves } from "../src/import.ts";
import { Run } from "../src/obs.ts";

const run = new Run("plan");
waves(STEPS).forEach((wave, i) => {
  console.log(`wave ${i + 1}:`);
  for (const step of wave) {
    const makes = step.makes.join(", ");
    const from = step.from.join(", ");
    console.log(`  ${makes} ← ${from}  (lesson ${step.lesson})`);
    run.event("step", { wave: i + 1, makes, from, lesson: step.lesson });
  }
});
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
