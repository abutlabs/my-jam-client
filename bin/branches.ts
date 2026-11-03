// Runs every branch on your PVM with r0 = −1 and r1 = 1 (ν_X = 1 for the immediate ones),
// and shows which of them jump: the same bits give different answers, unsigned and signed.
// Usage: npm run branches

import { Run } from "../src/obs.ts";
import { opcodeInfo } from "../src/pvm/instructions.ts";
import { newMachine, step } from "../src/pvm/machine.ts";
import { assemble } from "../src/pvm/program.ts";

const MINUS_ONE = 2n ** 64n - 1n; // all 64 bits set

const run = new Run("branches");
console.log("r0 = −1, against r1 = 1 or ν_X = 1:");
for (let opcode = 0; opcode < 256; opcode++) {
  const name = opcodeInfo(opcode)?.name ?? "";
  if (!name.startsWith("branch_")) continue;
  const branch = name.endsWith("_imm") ? [opcode, 0x10, 1, 5] : [opcode, 0x10, 5]; // to 5
  const fallthroughs = Array.from({ length: 5 - branch.length }, () => [1]);
  const machine = newMachine(assemble([branch, ...fallthroughs, [0]]), [MINUS_ONE, 1n]);
  step(machine);
  const taken = machine.pc === 5;
  console.log(`${name.padEnd(16)} ${taken ? "jumps" : "falls through"}`);
  run.event("branch", { name, taken });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
