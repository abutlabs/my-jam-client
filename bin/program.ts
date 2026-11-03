// Unpacks a service's code from the state before a trace's block, layer by layer: the
// metadata, the standard program, and the PVM blob's jump table, code and bitmask.
// Usage: npm run program <trace.json> [service id, 0 unless you say], e.g.
//        npm run program ../vectors/traces/fallback/00000001.json

import { readFileSync } from "node:fs";
import { fromHex } from "../src/bytes.ts";
import { Run } from "../src/obs.ts";
import { deblob, startsInstruction, unpackCode } from "../src/pvm/program.ts";
import { serviceCode } from "../src/services.ts";
import type { KeyValue } from "../src/trie.ts";

const [file, id] = process.argv.slice(2);
const trace = JSON.parse(readFileSync(file, "utf8"));
const entries: KeyValue[] = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const preimage = serviceCode(entries, Number(id ?? 0));
if (!preimage) throw new Error("the service's code isn't in this state");
const code = unpackCode(preimage);
const program = deblob(code.program);
const opcodes = new Map<number, number>(); // how often each opcode starts an instruction
for (let i = 0; i < program.code.length; i++) {
  if (!startsInstruction(program, i)) continue;
  const opcode = program.code[i];
  opcodes.set(opcode, (opcodes.get(opcode) ?? 0) + 1);
}
const instructions = [...opcodes.values()].reduce((a, b) => a + b, 0);
const common = [...opcodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
const run = new Run("program");
const lines = [
  `the code preimage: ${preimage.length} bytes`,
  `  metadata: ${code.metadata.length} bytes`,
  `  read-only data ${code.readOnly.length}, read-write ${code.readWrite.length}, ` +
    `heap pages ${code.heapPages}, stack ${code.stackSize}`,
  `  the PVM blob: ${code.program.length} bytes`,
  `    jump table: ${program.jumpTable.length} entries`,
  `    code: ${program.code.length} bytes, ${instructions} instructions`,
  `    bitmask: ${program.bitmask.length} bytes`,
  `most common opcodes: ${common.map(([op, n]) => `${op} (${n}×)`).join(", ")}`,
];
for (const line of lines) {
  console.log(line);
  run.event("layer", { line });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
