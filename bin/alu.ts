// Runs the arithmetic edge cases the Gray Paper spells out, each as one instruction on
// your PVM, and shows the answers in hex and as signed numbers.
// Usage: npm run alu

import { Run } from "../src/obs.ts";
import { decodeInstruction } from "../src/pvm/instructions.ts";
import { newMachine, step } from "../src/pvm/machine.ts";
import { assemble } from "../src/pvm/program.ts";

const neg = (x: bigint) => 2n ** 64n - x; // −x, as 64 unsigned bits
const signed = (x: bigint) => (x >= 2n ** 63n ? x - 2n ** 64n : x);

/** Each case: an instruction [opcode, A + 16·B, D], with r0 and r1; the answer lands in r2. */
const CASES: [number, bigint, bigint, string][] = [
  [190, 0x7fffffffn, 1n, "2^31 − 1 + 1, in 32 bits"],
  [203, 5n, 0n, "5 ÷ 0, unsigned"],
  [204, 2n ** 63n, neg(1n), "−2^63 ÷ −1: too big to fit"],
  [204, neg(7n), 2n, "−7 ÷ 2: towards zero"],
  [206, neg(7n), 2n, "−7 rem 2: the dividend's sign"],
  [209, neg(8n), 1n, "−8 >> 1, arithmetic"],
  [208, neg(8n), 1n, "−8 >> 1, logical"],
  [222, 1n, 1n, "1 rotated right by 1"],
  [214, neg(1n), neg(1n), "(2^64 − 1)², upper 64 bits"],
];

const run = new Run("alu");
for (const [opcode, r0, r1, what] of CASES) {
  const program = assemble([[opcode, 0x10, 2]]);
  const machine = newMachine(program, [r0, r1]);
  step(machine);
  const r2 = machine.registers[2];
  const { name } = decodeInstruction(program, 0);
  const answer = `0x${r2.toString(16).padStart(16, "0")} = ${signed(r2)}`;
  console.log(`${name.padEnd(14)} ${what.padEnd(32)} ${answer}`);
  run.event("case", { name, what, answer });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
