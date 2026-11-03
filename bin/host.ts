// Runs a real service's accumulation, Ψ_A, and shows every host call it makes, the answer
// it gets, and the transfers it sends. The service, its inputs and its gas come from an
// accumulate test vector: service 1729 of always_accumulate-1 if you don't say.
// Usage: npm run host [vector] [service]

import { readFileSync } from "node:fs";
import { serviceInputs } from "../src/accumulate.ts";
import { fromHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import { accumulate, HOST_CALLS, NONE, WHAT, CASH, CORE, FULL, HUH, LOW, WHO } from "../src/host.ts";
import { Run } from "../src/obs.ts";
import { unpackCode } from "../src/pvm/program.ts";
import type { AccountJson } from "../src/services.ts";
import { accountFromJson, copyAccounts } from "../src/services.ts";
import { WorkReport } from "../src/work.ts";

const file = process.argv[2] ?? "../vectors/stf/accumulate/tiny/always_accumulate-1.json";
const s = Number(process.argv[3] ?? 1729);
const vector = JSON.parse(readFileSync(file, "utf8"));
const pre = vector.pre_state;
const json: { id: number; data: AccountJson }[] = pre.accounts;
const accounts = new Map(json.map((x) => [x.id, accountFromJson(x.data)]));
const data = pre.accounts.find((x: { id: number }) => x.id === s).data;
const blobs: { hash: string; blob: string }[] = data.preimage_blobs;
const preimage = blobs.find((p) => p.hash === data.service.code_hash)!; // its code
const reports = vector.input.reports.map((r: unknown) => WorkReport.fromJson(r));
const free = pre.privileges.always_acc.find((x: { id: number }) => x.id === s)?.gas ?? 0;
const { inputs, gas } = serviceInputs(reports, s, BigInt(free));
const a = {
  id: s,
  accounts,
  checkpoint: copyAccounts(accounts),
  code: unpackCode(fromHex(preimage.blob)),
  entropy: fromHex(pre.entropy),
  inputs,
  privileges: {
    bless: pre.privileges.bless,
    assign: pre.privileges.assign,
    designate: pre.privileges.designate,
    register: pre.privileges.register,
  },
};

const run = new Run("host");
const result = accumulate(TINY, a, vector.input.slot, gas, (call, m) => {
  const name = HOST_CALLS[call] ?? (call === 100 ? "log, from JIP-1" : "?");
  const said = answerName(m.registers[7]);
  console.log(`host call ${call} (${name}): φ₇ = ${said}, ${m.gas} gas left`);
  run.event("call", { call, name, said, gas: Number(m.gas) });
});
for (const t of result.transfers) {
  const memo = new TextDecoder().decode(t.memo).replace(/\0+$/, ""); // without trailing zeros
  console.log(`sent ${t.amount} to service ${t.dest}, with ${t.gas} gas and the memo "${memo}"`);
  run.event("sent", { dest: t.dest, amount: Number(t.amount), gas: Number(t.gas), memo });
}
const expected = vector.post_state.statistics.find((x: { id: number }) => x.id === s);
console.log(`the service stops: ${JSON.stringify(result.exit)}, using ${result.gasUsed} gas`);
console.log(`the test vector says: ${expected.record.accumulate_gas_used}`);
run.event("stop", { exit: JSON.stringify(result.exit), used: Number(result.gasUsed) });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);

/** φ₇ as the host's answer, by name if it's one of them (GP App. B.1), or as a number. */
function answerName(r7: bigint): string {
  const names = { NONE, WHAT, WHO, FULL, CORE, CASH, LOW, HUH };
  const found = Object.entries(names).find(([, code]) => code === r7);
  return found ? found[0] : String(r7);
}
