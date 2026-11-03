// Reads a service's account from the state before a trace's block: its record, its code,
// and what it must keep in its balance for what it stores.
// Usage: npm run service <trace.json> [service id, 0 unless you say], e.g.
//        npm run service ../vectors/traces/storage/00000100.json

import { readFileSync } from "node:fs";
import { fromHex, toHex } from "../src/bytes.ts";
import { Run } from "../src/obs.ts";
import { minimumBalance, readService, serviceCode } from "../src/services.ts";
import type { KeyValue } from "../src/trie.ts";

const [file, id] = process.argv.slice(2);
const s = Number(id ?? 0);
const trace = JSON.parse(readFileSync(file, "utf8"));
const entries: KeyValue[] = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const service = readService(entries, s);
const code = serviceCode(entries, s);
const run = new Run("service");
const lines = [
  `service ${s}, created at slot ${service.creation_slot} by service ${service.parent_service}`,
  `code hash ${toHex(service.code_hash).slice(0, 18)}…: ${code?.length} bytes of code`,
  `keeps ${service.items} items in ${service.bytes} bytes`,
  `balance ${service.balance}, of which it must keep ${minimumBalance(service)}`,
  `last accumulated at slot ${service.last_accumulation_slot}`,
];
for (const line of lines) {
  console.log(line);
  run.event("fact", { line });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
