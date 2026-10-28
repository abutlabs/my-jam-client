// Safrole (GP §6): JAM's block-production engine. It decides who may seal each slot, and
// keeps the chain's randomness fresh.

import type { Bytes } from "./bytes.ts";
import { concatBytes, toHex, fromHex } from "./bytes.ts";
import { entropyHistory } from "./epoch.ts";
import { blake2b256 } from "./hash.ts";
import type { Config } from "./config.ts";
import { decodeFixed, encodeFixed } from "./codec/numbers.ts";
import { epochOf, phaseOf } from "./epoch.ts";
import { TicketBody } from "./block.ts";
import type { EpochMark } from "./block.ts";
import { ValidatorKey } from "./state.ts";

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

/**
 * F: the fallback sealers, one Bandersnatch key per slot of an epoch. Slot i goes to the
 * validator at ℰ₄⁻¹(the first four bytes of H(r ⌢ ℰ₄(i))), counted round the set.
 */
export function fallbackKeys(config: Config, r: Bytes, validators: ValidatorKey[]): Bytes[] {
  const keys: Bytes[] = [];
  for (let i = 0; i < config.epoch_length; i++) {
    const hash = blake2b256(concatBytes(r, encodeFixed(BigInt(i), 4)));
    const index = Number(decodeFixed(hash.subarray(0, 4))) % validators.length;
    keys.push(validators[index].bandersnatch);
  }
  return keys;
}

/** Z: outside in. The first, the last, the second, the second to last, and so on inwards. */
export function outsideIn<T>(items: T[]): T[] {
  const out: T[] = [];
  let front = 0;
  let back = items.length - 1;
  while (front <= back) {
    out.push(items[front]);
    if (front < back) out.push(items[back]);
    front++;
    back--;
  }
  return out;
}

/** Whether the lottery closes in this block: the same epoch, and phase Y is reached now. */
function lotteryCloses(config: Config, before: number, after: number): boolean {
  const Y = config.epoch_tail_start;
  const sameEpoch = epochOf(config, after) === epochOf(config, before);
  return sameEpoch && phaseOf(config, before) < Y && Y <= phaseOf(config, after);
}

/** H_W, the tickets mark: in the block that closes a full lottery, the winners, outside in. */
export function ticketsMark(
  config: Config,
  before: number, // the slot of the block before, τ
  after: number, // this block's slot, τ′
  accumulator: TicketBody[], // γ_A: the best tickets so far, by id
): TicketBody[] | null {
  const full = accumulator.length === config.epoch_length;
  return lotteryCloses(config, before, after) && full ? outsideIn(accumulator) : null;
}

/**
 * Whether a new epoch is sealed by the lottery's winners rather than the fallback: the
 * last epoch's lottery closed full, and this block follows on from that epoch directly.
 */
export function sealedByTickets(
  config: Config,
  before: number,
  after: number,
  accumulator: TicketBody[],
): boolean {
  const next = epochOf(config, after) === epochOf(config, before) + 1;
  const closed = phaseOf(config, before) >= config.epoch_tail_start;
  return next && closed && accumulator.length === config.epoch_length;
}

/** γ_S, who seals each slot of this epoch: the lottery's winning tickets, or fallback keys. */
export type Sealers = { tickets: TicketBody[] } | { keys: Bytes[] };

/** Safrole's part of the state (GP §6), as your client keeps it. */
export type Safrole = {
  time: number; // τ: the slot of the most recent block
  entropy: Bytes[]; // η
  validators: ValidatorSets; // ι, γ_P, κ, λ
  accumulator: TicketBody[]; // γ_A: the lottery's best tickets so far
  sealers: Sealers; // γ_S
};

/**
 * One block of Safrole (GP §6), for a block that brings no tickets: the state after it,
 * and the two marks its header must carry.
 */
export function safroleStep(
  config: Config,
  before: Safrole,
  slot: number, // the block's slot, τ′
  vrfOutput: Bytes, // Y(H_v), from the block's entropy source
  offenders: Bytes[], // ψ′_O: Ed25519 keys convicted in disputes
) {
  const newEpoch = epochOf(config, slot) > epochOf(config, before.time);
  const entropy = nextEntropy(before.entropy, vrfOutput, newEpoch);
  const validators = newEpoch ? rotateValidators(before.validators, offenders) : before.validators;
  let sealers = before.sealers;
  if (sealedByTickets(config, before.time, slot, before.accumulator)) {
    sealers = { tickets: outsideIn(before.accumulator) };
  } else if (newEpoch) {
    sealers = { keys: fallbackKeys(config, entropy[2], validators.active) };
  }
  const after: Safrole = {
    time: slot,
    entropy,
    validators,
    accumulator: newEpoch ? [] : before.accumulator, // a new epoch starts a new lottery
    sealers,
  };
  // the epoch mark: η₀ and η₁ as they were, and γ′_P, the validators after next, by two keys
  const keys = validators.pending.map(({ bandersnatch, ed25519 }) => ({ bandersnatch, ed25519 }));
  const epochMark: EpochMark | null = newEpoch
    ? { entropy: before.entropy[0], tickets_entropy: before.entropy[1], validators: keys }
    : null;
  const tickets = ticketsMark(config, before.time, slot, before.accumulator);
  return { after, epochMark, ticketsMark: tickets };
}

/** Safrole's state as the test vectors write it, under the Gray Paper's Greek names. */
export type SafroleJson = {
  tau: number;
  eta: string[];
  iota: unknown[];
  gamma_k: unknown[];
  kappa: unknown[];
  lambda: unknown[];
  gamma_a: unknown[];
  gamma_s: { keys?: string[]; tickets?: unknown[] };
};

/** Safrole's state, from the vectors' JSON. */
export function safroleFromJson(json: SafroleJson): Safrole {
  const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
  const tickets = (list: unknown[]) => list.map((ticket) => TicketBody.fromJson(ticket));
  const { keys: fallback, tickets: winners } = json.gamma_s;
  return {
    time: json.tau,
    entropy: json.eta.map(fromHex),
    validators: {
      staging: keys(json.iota),
      pending: keys(json.gamma_k),
      active: keys(json.kappa),
      previous: keys(json.lambda),
    },
    accumulator: tickets(json.gamma_a),
    sealers: winners ? { tickets: tickets(winners) } : { keys: (fallback ?? []).map(fromHex) },
  };
}