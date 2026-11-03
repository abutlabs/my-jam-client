// Runs a hand-written program on your PVM, one step at a time: it adds 10 + 9 + … + 1 into
// r2, then returns through r0, which halts the machine.
// Usage: npm run run

import { decodeInstruction } from "../src/pvm/instructions.ts";
import { HALT_ADDRESS, newMachine, step } from "../src/pvm/machine.ts";
import { assemble } from "../src/pvm/program.ts";
import { Run } from "../src/obs.ts";

const SUM = assemble([
  [51, 0x02], //               0: load_imm r2, 0
  [51, 0x03, 10], //           2: load_imm r3, 10
  [1], //                      5: fallthrough
  [200, 0x32, 0x02], //        6: add_64 r2 = r2 + r3
  [149, 0x33, 0xff], //        9: add_imm_64 r3 = r3 + (−1)
  [82, 0x03, 0xfa], //        12: branch_ne_imm r3, 0, back to 6
  [50, 0x00], //              15: jump_ind r0 + 0
]);

const machine = newMachine(SUM, [HALT_ADDRESS]);
const run = new Run("run");
for (let n = 1; ; n++) {
  const at = machine.pc;
  const { name } = decodeInstruction(SUM, at);
  const before = [...machine.registers];
  const exit = step(machine);
  const changed = machine.registers.flatMap((v, r) => (v !== before[r] ? [`r${r} = ${v}`] : []));
  const where = `step ${String(n).padStart(2)}  at ${String(at).padStart(2)}`;
  console.log(`${where}  ${name.padEnd(14)} ${changed.join(", ")}`);
  run.event("step", { n, at, name, changed: changed.join(", "), exit });
  if (exit !== "continue") {
    console.log(`the machine stops: ${exit}, with r2 = ${machine.registers[2]}`);
    break;
  }
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
