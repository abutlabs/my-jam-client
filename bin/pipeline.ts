// Runs a real basic block through the model CPU, the one the bootstrap service's
// accumulation jumps to first, and draws its reorder buffer cycle by cycle.
// Usage: npm run pipeline

import { readFileSync } from "node:fs";
import { fromHex } from "../src/bytes.ts";
import { Run } from "../src/obs.ts";
import { blockCost } from "../src/pvm/gas.ts";
import { decodeInstruction } from "../src/pvm/instructions.ts";
import { deblob, unpackCode } from "../src/pvm/program.ts";
import { serviceCode } from "../src/services.ts";
import type { KeyValue } from "../src/trie.ts";

const trace = JSON.parse(readFileSync("../vectors/traces/fallback/00000001.json", "utf8"));
const entries: KeyValue[] = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const program = deblob(unpackCode(serviceCode(entries, 0)!).program);
const start = decodeInstruction(program, 5).target as number; // where accumulation jumps

const LETTER = { DEC: "D", WAIT: "W", EXE: "E", FIN: "F" } as const;
const run = new Run("pipeline");
let last = "";
const cost = blockCost(program, start, (cpu) => {
  const row = cpu.rob.map((e) => (e.state === null ? "." : LETTER[e.state])).join(" ");
  if (row === last) return; // only the cycles where something changes
  last = row;
  console.log(`cycle ${String(cpu.cycles).padStart(2)}  ${row}`);
  run.event("cycle", { cycle: cpu.cycles, row });
});
console.log(`the block at ${start} costs ${cost} gas`);
run.event("cost", { block: start, cost });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
