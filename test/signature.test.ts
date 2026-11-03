import { test } from "node:test";
import assert from "node:assert/strict";
import { Assurance, assuranceSigned } from "../src/block.ts";
import { fromHex } from "../src/bytes.ts";
import type { Config } from "../src/config.ts";
import { FULL, TINY } from "../src/config.ts";
import { verifyEd25519 } from "../src/signature.ts";
import { vectorJson } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";

test("Ed25519: RFC 8032's first example, a signature of no bytes at all", () => {
  const key: Bytes = fromHex("0xd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
  const signature: Bytes = fromHex(
    "0xe5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
      "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  );
  const valid: boolean = verifyEd25519(key, new Uint8Array(0), signature);
  assert.equal(valid, true);
  const forAnotherMessage: boolean = verifyEd25519(key, fromHex("0x00"), signature);
  assert.equal(forAnotherMessage, false);
});

/** For each assurance in an assurances test vector: is it signed by the validator it names? */
function signedAssurances(config: Config, name: string): boolean[] {
  const vector = vectorJson(`stf/assurances/${config.name}/${name}.json`) as {
    input: { assurances: unknown[] };
    pre_state: { curr_validators: { ed25519: string }[] };
  };
  const keys = vector.pre_state.curr_validators.map((v) => fromHex(v.ed25519));
  return vector.input.assurances.map((a) => assuranceSigned(keys, Assurance(config).fromJson(a)));
}

test("every assurance is signed by the validator it names: 6 on tiny, 1023 on full", () => {
  const tiny: boolean[] = signedAssurances(TINY, "some_assurances-1");
  assert.deepEqual(tiny, Array(6).fill(true));
  const full: boolean[] = signedAssurances(FULL, "some_assurances-1");
  assert.deepEqual(full, Array(1023).fill(true));
});

test("a forged signature is caught", () => {
  const signed: boolean[] = signedAssurances(TINY, "assurances_with_bad_signature-1");
  assert.deepEqual(signed, [true, false, true, true, true, true]);
});
