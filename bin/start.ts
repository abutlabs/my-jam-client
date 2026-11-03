// Starts a real service: the bootstrap service, from the state before the first block of
// the fallback trace. Y lays out its memory and registers, and the machine runs from
// accumulation's entry point until the program calls the host.
// Usage: npm run start

import { readFileSync } from "node:fs";
import { fromHex } from "../src/bytes.ts";
import { encodeNatural } from "../src/codec/numbers.ts";
import { Run } from "../src/obs.ts";
import { decodeInstruction } from "../src/pvm/instructions.ts";
import { newMachine, step } from "../src/pvm/machine.ts";
import { PAGE_SIZE } from "../src/pvm/memory.ts";
import { deblob, unpackCode } from "../src/pvm/program.ts";
import { standardProgram } from "../src/pvm/standard.ts";
import { serviceCode } from "../src/services.ts";
import type { KeyValue } from "../src/trie.ts";

const trace = JSON.parse(readFileSync("../vectors/traces/fallback/00000001.json", "utf8"));
const entries: KeyValue[] = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const code = unpackCode(serviceCode(entries, 0)!);

const run = new Run("start");
const say = (line: string) => {
  console.log(line);
  run.event("line", { line });
};
const hex = (x: number | bigint) => `0x${x.toString(16).padStart(8, "0")}`;

// Accumulation's arguments (GP App. B): the slot, the service, and how many inputs.
const args = Uint8Array.from([...encodeNatural(1n), ...encodeNatural(0n), ...encodeNatural(0n)]);
const { memory, registers } = standardProgram(code, args);
say("memory, as Y lays it out:");
const pages = [...memory.keys()].sort((a, b) => a - b);
let first = pages[0]; // the first page of a run of pages with the same access
pages.forEach((page, i) => {
  const next = pages[i + 1];
  const access = memory.get(page)!.access;
  if (next === page + 1 && memory.get(next)!.access === access) return; // the run goes on
  const [from, to] = [hex(first * PAGE_SIZE), hex((page + 1) * PAGE_SIZE - 1)];
  say(`  ${from} to ${to}  ${access}  ${page - first + 1} page(s)`);
  first = next;
});
const [r0, r1, r7, r8] = [0, 1, 7, 8].map((r) => registers[r]);
say(`registers: r0 = ${hex(r0)}, r1 = ${hex(r1)}, r7 = ${hex(r7)}, r8 = ${r8}`);

const program = deblob(code.program);
const machine = newMachine(program, registers, memory);
machine.pc = 5; // where accumulation starts
for (let n = 1; ; n++) {
  const at = machine.pc;
  const { name } = decodeInstruction(program, at);
  const exit = step(machine);
  say(`step ${String(n).padStart(2)}  at ${String(at).padStart(6)}  ${name}`);
  if (exit !== "continue") {
    say(`the machine stops: ${JSON.stringify(exit)}, with r10 = ${machine.registers[10]}`);
    break;
  }
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
