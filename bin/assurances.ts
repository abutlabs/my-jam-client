// Checks the signature on every assurance in an assurances test vector, with the Ed25519
// keys of the validators in the vector's state.
// Usage: npm run assurances <vector.json>, e.g.
//        npm run assurances ../vectors/stf/assurances/tiny/some_assurances-1.json

import { readFileSync } from "node:fs";
import { Assurance, assuranceSigned } from "../src/block.ts";
import { fromHex } from "../src/bytes.ts";
import { FULL, TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";

const [file] = process.argv.slice(2);
const config = file.includes("/full/") ? FULL : TINY;
const vector = JSON.parse(readFileSync(file, "utf8"));
const keys = vector.pre_state.curr_validators.map((v: { ed25519: string }) => fromHex(v.ed25519));
const run = new Run("assurances");
let valid = 0;
for (const json of vector.input.assurances) {
  const assurance = Assurance(config).fromJson(json);
  const signed = assuranceSigned(keys, assurance);
  if (signed) valid++;
  const validator = assurance.validator_index;
  console.log(`validator ${validator}: ${signed ? "signed it" : "FORGED"}`);
  run.event("assurance", { validator, key: keys[validator], bitfield: assurance.bitfield, signed });
}
console.log(`${valid} of ${vector.input.assurances.length} signatures are valid.`);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);