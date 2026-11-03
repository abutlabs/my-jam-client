import { test } from "node:test";
import assert from "node:assert/strict";
import { HALT_ADDRESS, newMachine, run, step } from "../src/pvm/machine.ts";
import { assemble } from "../src/pvm/program.ts";
import type { Exit, Machine } from "../src/pvm/machine.ts";
import type { Program } from "../src/pvm/program.ts";

/** Adds 10 + 9 + … + 1 into r2, then returns through r0. */
const SUM = assemble([
  [51, 0x02], //               0: load_imm r2, 0
  [51, 0x03, 10], //           2: load_imm r3, 10
  [1], //                      5: fallthrough: the loop must start a basic block
  [200, 0x32, 0x02], //        6: add_64 r2 = r2 + r3
  [149, 0x33, 0xff], //        9: add_imm_64 r3 = r3 + (−1)
  [82, 0x03, 0xfa], //        12: branch_ne_imm r3, 0, back 6 bytes to 6
  [50, 0x00], //              15: jump_ind r0 + 0: return
]);

test("a loop adds 10 + 9 + … + 1, and returning through r0 halts", () => {
  const machine: Machine = newMachine(SUM, [HALT_ADDRESS]);
  const exit: Exit = run(machine);
  assert.equal(exit, "halt");
  assert.equal(machine.registers[2], 55n);
  assert.equal(machine.registers[3], 0n);
});

test("a jump must land at the start of a basic block, or the machine panics", () => {
  const toTheStart: Machine = newMachine(assemble([[51, 0x02, 1], [40, 0xfd]])); // jumps to 0
  const twoSteps: Exit[] = [step(toTheStart), step(toTheStart)];
  assert.deepEqual(twoSteps, ["continue", "continue"]);
  assert.equal(toTheStart.pc, 0); // 0 always starts a block
  const program: Program = assemble([[51, 0x02, 1], [51, 0x03, 2], [40, 0xfd]]); // jumps to 3
  const intoTheMiddle: Machine = newMachine(program);
  const steps: Exit[] = [step(intoTheMiddle), step(intoTheMiddle), step(intoTheMiddle)];
  assert.deepEqual(steps, ["continue", "continue", "panic"]); // 3 follows a load_imm
});

test("trap panics; jump_ind to anything else than the halt address, without a table, too", () => {
  const trapped: Exit = step(newMachine(assemble([[0]])));
  assert.equal(trapped, "panic");
  const jumped: Exit = run(newMachine(assemble([[50, 0x00]]), [8n])); // r0 = 8, no table
  assert.equal(jumped, "panic");
});
