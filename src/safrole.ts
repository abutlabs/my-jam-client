// Safrole (GP §6): JAM's block-production engine. It decides who may seal each slot, and
// keeps the chain's randomness fresh.

import type { Bytes } from "./bytes.ts";
import { concatBytes, toHex } from "./bytes.ts";
import { entropyHistory } from "./epoch.ts";
import { blake2b256 } from "./hash.ts";
import type { ValidatorKey } from "./state.ts";


export function nextEntropy(entropy: Bytes[], vrfOutput: Bytes, newEpoch: boolean): Bytes[] {
  const accumulator = blake2b256(concatBytes(entropy[0], vrfOutput));
  return [accumulator, ...entropyHistory(entropy, newEpoch)];
}

/** The validator sets Safrole keeps (GP §6), each a list of validator keys. */
export type ValidatorSets = {
  staging: ValidatorKey[]; // ι: next in line, chosen by a privileged service
  pending: ValidatorKey[]; // γ_P: active from the next epoch
  active: ValidatorKey[]; // κ: validating now
  previous: ValidatorKey[]; // λ: last epoch's, still needed to check its signatures
};

/** A validator key of all zeros: what an offender's keys become. */
const NULL_KEY: ValidatorKey = {
  bandersnatch: new Uint8Array(32),
  ed25519: new Uint8Array(32),
  bls: new Uint8Array(144),
  metadata: new Uint8Array(128),
};

/** Φ: the keys, with each offender's (found by its Ed25519 key) replaced by zeros. */
export function withoutOffenders(keys: ValidatorKey[], offenders: Bytes[]): ValidatorKey[] {
  const banned = new Set(offenders.map(toHex));
  return keys.map((key) => (banned.has(toHex(key.ed25519)) ? NULL_KEY : key));
}

/** At a new epoch (GP §6), the sets move along one: ι, minus offenders, → γ_P → κ → λ. */
export function rotateValidators(sets: ValidatorSets, offenders: Bytes[]): ValidatorSets {
  return {
    staging: sets.staging, // stays: only a privileged service changes ι
    pending: withoutOffenders(sets.staging, offenders),
    active: sets.pending,
    previous: sets.active,
  };
}