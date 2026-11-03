// Shows the cost sheet of a real basic block: the one the bootstrap service's accumulation
// jumps to first. Each instruction's cycles, decode slots and execution units.
// Usage: npm run costs

import { readFileSync } from "node:fs";
import { fromHex } from "../src/bytes.ts";
import { Run } from "../src/obs.ts";
import { instructionCost } from "../src/pvm/gas.ts";
import { decodeInstruction } from "../src/pvm/instructions.ts";
import { basicBlocks } from "../src/pvm/machine.ts";
import { deblob, unpackCode } from "../src/pvm/program.ts";
import { serviceCode } from "../src/services.ts";
import type { KeyValue } from "../src/trie.ts";

const trace = JSON.parse(readFileSync("../vectors/traces/fallback/00000001.json", "utf8"));
const entries: KeyValue[] = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const program = deblob(unpackCode(serviceCode(entries, 0)!).program);
const blocks = basicBlocks(program);

const UNITS = ["ALU", "load", "store", "mul", "div"];
const run = new Run("costs");
let at = decodeInstruction(program, 5).target as number; // where accumulation's jump goes
console.log(`the basic block at ${at}:`);
for (;;) {
  const ins = decodeInstruction(program, at);
  const { cycles, slots, units } = instructionCost(program, ins);
  const used = UNITS.filter((_, k) => units[k] > 0).join("+") || "none";
  const row = `${ins.name.padEnd(16)} cycles ${String(cycles).padStart(3)}  slots ${slots}`;
  console.log(`${row}  ${used}`);
  run.event("cost", { at, name: ins.name, cycles, slots, units: used });
  if (blocks.has(ins.next)) break; // the next instruction starts another block
  at = ins.next;
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
