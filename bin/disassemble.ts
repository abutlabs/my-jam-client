// Disassembles a stretch of a service's code from the state before a trace's block: each
// instruction's place, name, registers, immediates and jump target.
// Usage: npm run disassemble <trace.json> [from, 0 unless you say] [how many, 12], e.g.
//        npm run disassemble ../vectors/traces/fallback/00000001.json 80282

import { readFileSync } from "node:fs";
import { fromHex } from "../src/bytes.ts";
import { Run } from "../src/obs.ts";
import type { Instruction } from "../src/pvm/instructions.ts";
import { decodeInstruction } from "../src/pvm/instructions.ts";
import { deblob, unpackCode } from "../src/pvm/program.ts";
import { serviceCode } from "../src/services.ts";
import type { KeyValue } from "../src/trie.ts";

const [file, from, count] = process.argv.slice(2);
const trace = JSON.parse(readFileSync(file, "utf8"));
const entries: KeyValue[] = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const preimage = serviceCode(entries, 0);
if (!preimage) throw new Error("service 0's code isn't in this state");
const program = deblob(unpackCode(preimage).program);

/** An immediate as a person would write it: negative if its top bit is set. */
const show = (x: bigint) => String(x >= 2n ** 63n ? x - 2n ** 64n : x);

/** An instruction in one line: name, registers, immediates, target. */
function line({ name, registers, immediates, target }: Instruction): string {
  const args = [...registers.map((r) => `r${r}`), ...immediates.map(show)];
  if (target !== undefined) args.push(`→ ${target}`);
  return `${name.padEnd(16)} ${args.join(", ")}`;
}

const run = new Run("disassemble");
let at = Number(from ?? 0);
for (let n = 0; n < Number(count ?? 12) && at < program.code.length; n++) {
  const instruction = decodeInstruction(program, at);
  console.log(`${String(at).padStart(7)}  ${line(instruction)}`);
  run.event("instruction", { at, text: line(instruction) });
  at = instruction.next;
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
