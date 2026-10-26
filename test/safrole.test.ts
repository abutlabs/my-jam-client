import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex } from "../src/bytes.ts";
import type { Config } from "../src/config.ts";
import { FULL, TINY } from "../src/config.ts";
import { epochOf } from "../src/epoch.ts";
import type { ValidatorSets } from "../src/safrole.ts";
import { nextEntropy, rotateValidators } from "../src/safrole.ts";
import { ValidatorKey } from "../src/state.ts";
import { vectorFiles, vectorJson } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";

/** The parts of a safrole vector's state the lessons use so far. */
type SafroleState = {
  tau: number;
  eta: string[];
  iota: unknown[];
  gamma_k: unknown[];
  kappa: unknown[];
  lambda: unknown[];
  post_offenders: string[];
};

/** A safrole test vector: the parts of it the lessons use so far. */
type SafroleVector = {
  input: { slot: number; entropy: string };
  pre_state: SafroleState;
  post_state: SafroleState;
  output: { err?: string };
};

/** A safrole vector whose block is accepted, and whether that block starts a new epoch. */
type Accepted = { config: Config; name: string; vector: SafroleVector; newEpoch: boolean };

/** Every accepted safrole vector, at both sizes. A rejected block changes nothing. */
function acceptedVectors(): Accepted[] {
  const accepted: Accepted[] = [];
  for (const config of [TINY, FULL]) {
    for (const name of vectorFiles(`stf/safrole/${config.name}`)) {
      const vector = vectorJson(name) as SafroleVector;
      if (vector.output.err) continue;
      const newEpoch = epochOf(config, vector.input.slot) > epochOf(config, vector.pre_state.tau);
      accepted.push({ config, name, vector, newEpoch });
    }
  }
  return accepted;
}

test("η′: each block stirs its VRF output into η₀, and a new epoch moves the history", () => {
  const accepted: Accepted[] = acceptedVectors();
  for (const { name, vector, newEpoch } of accepted) {
    const { input, pre_state, post_state } = vector;
    const vrfOutput: Bytes = fromHex(input.entropy);
    const eta: Bytes[] = nextEntropy(pre_state.eta.map(fromHex), vrfOutput, newEpoch);
    const etaHex: string[] = eta.map(toHex);
    assert.deepEqual(etaHex, post_state.eta, name);
  }
  assert.equal(accepted.length, 33); // 15 tiny, 18 full
});

/** The four validator sets of a safrole vector's state, by your client's names for them. */
function validatorSets(state: SafroleState): ValidatorSets {
  const read = (keys: unknown[]) => keys.map((key) => ValidatorKey.fromJson(key));
  return {
    staging: read(state.iota),
    pending: read(state.gamma_k),
    active: read(state.kappa),
    previous: read(state.lambda),
  };
}

test("at a new epoch the validator sets move along one, with offenders zeroed", () => {
  let rotations = 0;
  for (const { name, vector, newEpoch } of acceptedVectors()) {
    const before: ValidatorSets = validatorSets(vector.pre_state);
    const offenders: Bytes[] = vector.pre_state.post_offenders.map(fromHex);
    const expected: ValidatorSets = newEpoch ? rotateValidators(before, offenders) : before;
    const after: ValidatorSets = validatorSets(vector.post_state);
    assert.deepEqual(after, expected, name);
    if (newEpoch) rotations++;
  }
  assert.equal(rotations, 14); // 6 tiny, 8 full
});