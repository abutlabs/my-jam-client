// Shows who seals each slot of the new epoch when a safrole test vector falls back to F:
// every slot's key, and which validator of κ′ it belongs to.
// Usage: npm run sealers <vector.json>, e.g.
//        npm run sealers ../vectors/stf/safrole/tiny/enact-epoch-change-with-no-tickets-4.json

import { readFileSync } from "node:fs";
import { fromHex, toHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";
import { fallbackKeys } from "../src/safrole.ts";
import { ValidatorKey } from "../src/state.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const { pre_state, post_state } = JSON.parse(readFileSync(file, "utf8"));
// at a new epoch, κ′ is the old pending set γ_P, and η′₂ is the old η₁
const active = pre_state.gamma_k.map((key: unknown) => ValidatorKey.fromJson(key));
const sealers = fallbackKeys(config, fromHex(pre_state.eta[1]), active);
const run = new Run("sealers");
const owners = active.map((v: ValidatorKey) => toHex(v.bandersnatch));
sealers.forEach((key, phase) => {
  const validator = owners.indexOf(toHex(key));
  console.log(`slot ${String(phase).padStart(3)} of the epoch: validator ${validator}`);
  run.event("sealer", { phase, validator, key });
});
const matches = sealers.every((key, phase) => toHex(key) === post_state.gamma_s.keys?.[phase]);
console.log(`the sealers match the vector: ${matches}`);
run.event("result", { matches });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
