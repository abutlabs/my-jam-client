// Runs the bootstrap service from accumulation's entry point with a gas budget, and shows
// each basic block it pays for on the way to its first host call. Then again, short.
// Usage: npm run gas

import { readFileSync } from "node:fs";
import { fromHex } from "../src/bytes.ts";
import { Run } from "../src/obs.ts";
import { stepWithGas } from "../src/pvm/gas.ts";
import { newMachine } from "../src/pvm/machine.ts";
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

const run = new Run("gas");
for (const budget of [1000n, 100n]) {
  const { memory, registers } = standardProgram(code, Uint8Array.from([1, 0, 0]));
  const machine = newMachine(deblob(code.program), registers, memory, budget);
  machine.pc = 5; // accumulation
  console.log(`with ${budget} gas:`);
  for (;;) {
    const [at, before] = [machine.pc, machine.gas];
    const exit = stepWithGas(machine);
    if (machine.gas !== before) {
      const paid = before - machine.gas;
      console.log(`  block at ${String(at).padStart(6)} costs ${paid}, leaving ${machine.gas}`);
      run.event("block", { budget: Number(budget), at, paid: Number(paid) });
    }
    if (exit !== "continue") {
      const spent = budget - machine.gas;
      console.log(`  stops: ${JSON.stringify(exit)} at ${machine.pc}, having spent ${spent}`);
      const stop = { budget: Number(budget), exit: JSON.stringify(exit), spent: Number(spent) };
      run.event("stop", stop);
      break;
    }
  }
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
