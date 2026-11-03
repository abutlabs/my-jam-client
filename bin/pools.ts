// Shows each core's authorizer pool before and after the block of an authorizations test
// vector: which authorizer left, which joined. Each authorizer as its first 4 hex digits.
// Usage: npm run pools <vector.json>, e.g.
//        npm run pools ../vectors/stf/authorizations/tiny/progress_authorizations-2.json

import { readFileSync } from "node:fs";
import { AuthPools, AuthQueues, nextPools, QUEUE_SIZE, UsedAuthorizer } from "../src/authorization.ts";
import type { Bytes } from "../src/bytes.ts";
import { toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { input, pre_state } = JSON.parse(readFileSync(file, "utf8"));
const pools = AuthPools(config).fromJson(pre_state.auth_pools);
const queues = AuthQueues(config).fromJson(pre_state.auth_queues);
const used: UsedAuthorizer[] = input.auths.map((a: unknown) => UsedAuthorizer.fromJson(a));
const after = nextPools(pools, queues, used, input.slot);
const short = (pool: Bytes[]) => pool.map((a) => toHex(a).slice(2, 6)).join(" ");
const run = new Run("pools");
const entry = input.slot % QUEUE_SIZE; // where each queue is up to
console.log(`slot ${input.slot}: each core's next authorizer is queue entry ${entry}`);
// tiny: every core; full: just the cores that used an authorizer
const shown = config === TINY ? pools.map((_, core) => core) : used.map((u) => u.core);
for (const core of shown) {
  const left = used.find((u) => u.core === core);
  const gone = left ? toHex(left.auth_hash).slice(2, 6) : "nothing";
  const joined = toHex(queues[core][entry]).slice(2, 6);
  console.log(`core ${core}: ${short(pools[core])}`);
  console.log(`  − ${gone}, + ${joined}  →  ${short(after[core])}`);
  run.event("pool", { core, before: short(pools[core]), gone, joined, after: short(after[core]) });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
