// Runs the ten bit-and-byte instructions on one number, on your PVM, and shows its bits and
// every answer.
// Usage: npm run bits [number], e.g. npm run bits 0xdeadbeef (0x1f0 if not given)

import { Run } from "../src/obs.ts";
import { opcodeInfo, signed } from "../src/pvm/instructions.ts";
import { newMachine, step } from "../src/pvm/machine.ts";
import { assemble } from "../src/pvm/program.ts";

const x = BigInt.asUintN(64, BigInt(process.argv[2] ?? "0x1f0")); // as 64 unsigned bits
const hex = (v: bigint) => `0x${v.toString(16).padStart(16, "0")}`;

const run = new Run("bits");
console.log(`r0 = ${hex(x)}, in bits:`);
console.log(x.toString(2).padStart(64, "0"));
for (let opcode = 101; opcode <= 110; opcode++) {
  const { name } = opcodeInfo(opcode)!;
  const machine = newMachine(assemble([[opcode, 0x01]]), [x]); // r1 = the answer, from r0
  step(machine);
  const answer = `${hex(machine.registers[1])} = ${signed(8, machine.registers[1])}`;
  console.log(`${name.padEnd(22)} ${answer}`);
  run.event("bits", { name, x: hex(x), answer });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
