// Checks the guarantees and reports of every reports test vector of one size against the
// rules (the guarantees' first, then the reports'), and shows each verdict next to the
// vector's: accepted, or the first rule broken.
// Usage: npm run check-guarantees [tiny or full], tiny if not given

import { readdirSync, readFileSync } from "node:fs";
import { GuaranteesExtrinsic } from "../src/block.ts";
import { fromHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { PendingReports } from "../src/cores.ts";
import type { ServiceNeeds } from "../src/guarantors.ts";
import { guaranteeError, guarantorAssignments, reportError } from "../src/guarantors.ts";
import { RecentBlock } from "../src/history.ts";
import { Run } from "../src/obs.ts";
import { ValidatorKey } from "../src/state.ts";

type Service = { code_hash: string; min_item_gas: number };

const config = process.argv[2] === "full" ? FULL : TINY;
const dir = `../vectors/stf/reports/${config.name}`;
const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
const run = new Run("guarantee-check");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const { input, pre_state: pre, output } = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  const assignments = guarantorAssignments(config, input.slot, pre.entropy.map(fromHex),
    keys(pre.curr_validators), keys(pre.prev_validators), pre.offenders.map(fromHex));
  const guarantees = GuaranteesExtrinsic.fromJson(input.guarantees);
  const cores = PendingReports(config).fromJson(pre.avail_assignments);
  const pools = pre.auth_pools.map((pool: string[]) => pool.map(fromHex));
  const history = pre.recent_blocks.history.map((b: unknown) => RecentBlock.fromJson(b));
  const services = new Map<number, ServiceNeeds>();
  for (const { id, data } of pre.accounts as { id: number; data: { service: Service } }[]) {
    const { code_hash, min_item_gas } = data.service;
    services.set(id, { code_hash: fromHex(code_hash), min_item_gas: BigInt(min_item_gas) });
  }
  const error =
    guaranteeError(config, guarantees, input.slot, assignments, cores, pools,
      pre.curr_validators.length) ??
    reportError(guarantees.map((g) => g.report), history, new Set(input.known_packages), services);
  const ours = error ?? "accepted";
  const theirs = output.err ?? "accepted";
  const name = file.replace(".json", "");
  console.log(`${name}: ${ours}${ours === theirs ? "" : ` (the vector says ${theirs})`}`);
  run.event("vector", { name, ours, theirs, agree: ours === theirs });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
