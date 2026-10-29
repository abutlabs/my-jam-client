// Safrole (GP §6): JAM's block-production engine. It decides who may seal each slot, and
// keeps the chain's randomness fresh.

import type { Bytes } from "./bytes.ts";
import { concatBytes, toHex, fromHex } from "./bytes.ts";
import { entropyHistory } from "./epoch.ts";
import { blake2b256 } from "./hash.ts";
import type { Config } from "./config.ts";
import { decodeFixed, encodeFixed } from "./codec/numbers.ts";
import { epochOf, phaseOf } from "./epoch.ts";
import { TicketBody, Header } from "./block.ts";
import type { EpochMark, TicketEnvelope } from "./block.ts";
import { ValidatorKey } from "./state.ts";
import { vrfOutput, ringRoot, ringProofsHold, checkSignature } from "./bandersnatch.ts";
import { encode } from "./codec/codec.ts";

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
  ringRoot: Bytes; // γ_Z: the ring root of γ_P's Bandersnatch keys
};

/**
 * One block of Safrole (GP §6): the state after it, and the two marks its header must
 * carry. Its tickets join the lottery: each one's id is its proof's VRF output, and the
 * lottery keeps the E lowest ids, old and new (none old at a new epoch).
 */
export function safroleStep(
  config: Config,
  before: Safrole,
  slot: number, // the block's slot, τ′
  vrfOutput: Bytes, // Y(H_v), from the block's entropy source
  offenders: Bytes[], // ψ′_O: Ed25519 keys convicted in disputes
  tickets: TicketEnvelope[] = [], // the block's tickets extrinsic, already checked
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
  const entered = tickets.map((t) => ({ id: ticketId(t), attempt: t.attempt }));
  const kept = newEpoch ? [] : before.accumulator; // a new epoch starts a new lottery
  const accumulator = [...kept, ...entered].sort(byId).slice(0, config.epoch_length);
  const ring = newEpoch ? ringRootOf(config, validators.pending) : before.ringRoot; // γ′_Z
  const after: Safrole = { time: slot, entropy, validators, accumulator, sealers, ringRoot: ring };
  // the epoch mark: η₀ and η₁ as they were, and γ′_P, the validators after next, by two keys
  const keys = validators.pending.map(({ bandersnatch, ed25519 }) => ({ bandersnatch, ed25519 }));
  const epochMark: EpochMark | null = newEpoch
    ? { entropy: before.entropy[0], tickets_entropy: before.entropy[1], validators: keys }
    : null;
  const marked = ticketsMark(config, before.time, slot, before.accumulator);
  return { after, epochMark, ticketsMark: marked };
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
  gamma_z: string;
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
    ringRoot: fromHex(json.gamma_z),
  };
}

/**
 * Why Safrole refuses a block (GP §6), or null if it doesn't: its slot isn't after the last
 * block's (bad_slot); it brings tickets once the lottery has closed, or more than K
 * (unexpected_ticket); a ticket's attempt is n or more (bad_ticket_attempt); the ids don't
 * go strictly up (bad_ticket_order); one is in the lottery already (duplicate_ticket); or
 * a ring proof doesn't check out against γ′_Z (bad_ticket_proof).
 */
export function safroleError(
  config: Config,
  before: Safrole,
  slot: number,
  tickets: TicketEnvelope[],
  offenders: Bytes[] = [], // ψ′_O, for γ′_P at a new epoch
): string | null {
  if (slot <= before.time) return "bad_slot";
  const open = phaseOf(config, slot) < config.epoch_tail_start;
  if (tickets.length > (open ? config.max_tickets_per_extrinsic : 0)) return "unexpected_ticket";
  if (tickets.length === 0) return null;
  const newEpoch = epochOf(config, slot) > epochOf(config, before.time);
  const { pending } = newEpoch ? rotateValidators(before.validators, offenders) : before.validators;
  const n = attemptsAllowed(config, pending.length); // γ′_P's size
  if (tickets.some((t) => t.attempt >= n)) return "bad_ticket_attempt";
  const ids = tickets.map((t) => toHex(ticketId(t)));
  if (ids.some((id, i) => i > 0 && id <= ids[i - 1])) return "bad_ticket_order";
  const held = new Set(before.accumulator.map((t) => toHex(t.id)));
  if (ids.some((id) => held.has(id))) return "duplicate_ticket";
  const ring = newEpoch ? ringRootOf(config, pending) : before.ringRoot; // γ′_Z
  const eta2 = newEpoch ? before.entropy[1] : before.entropy[2]; // η′₂
  const proofs = tickets.map((t) => ({ proof: t.signature, input: ticketInput(eta2, t.attempt) }));
  if (!ringProofsHold(ring, config.validators_count, proofs)) return "bad_ticket_proof";
  return null;
}

/** A ticket's id (GP §6): the VRF output of its proof. */
export function ticketId(ticket: TicketEnvelope): Bytes {
  return vrfOutput(ticket.signature);
}

/** Orders tickets by id, the lowest (the best) first. */
const byId = (x: TicketBody, y: TicketBody) => (toHex(x.id) < toHex(y.id) ? -1 : 1);

/** n (GP §6): the tickets each validator may enter, ⌈2E / |γ′_P|⌉: fewer validators, more each. */
export function attemptsAllowed(config: Config, validators: number): number {
  return Math.ceil((2 * config.epoch_length) / validators);
}

/** γ_Z (GP §6): the ring root of some validators' Bandersnatch keys, in a ring as big as
 * the chain's validator set. */
export function ringRootOf(config: Config, validators: ValidatorKey[]): Bytes {
  return ringRoot(validators.map((v) => v.bandersnatch), config.validators_count);
}

/** X_T (GP §6): the context of a ticket's ring proof, "$jam_ticket_seal" without the $. */
const TICKET_SEAL = new TextEncoder().encode("jam_ticket_seal");

/** What a ticket's ring proof signs: X_T ⌢ η′₂ ⌢ its attempt, one byte. */
export function ticketInput(eta2: Bytes, attempt: number): Bytes {
  return concatBytes(TICKET_SEAL, eta2, Uint8Array.of(attempt));
}

/**
 * Why a header's seal or entropy source is wrong (GP §6), or null if both check out. The
 * author's Bandersnatch key (κ′[H_I]) must have signed the header without its seal, for the
 * context of its slot's entry in γ′_S: a winning ticket (X_T ⌢ η′₃ ⌢ its attempt, and the
 * seal's output must be that ticket's id) or a fallback key (X_F ⌢ η′₃, and it must be the
 * author's). The entropy source must be the author's signature on X_E ⌢ the seal's output.
 */
export function sealError(
  config: Config,
  header: Header,
  author: Bytes, // κ′[H_I]: the author's Bandersnatch key
  sealers: Sealers, // γ′_S
  eta3: Bytes, // η′₃
): string | null {
  const encoded = encode(Header(config), header);
  const unsigned = encoded.subarray(0, encoded.length - 96); // ℰ_U(H): all but the seal
  const phase = phaseOf(config, header.slot);
  let output: Bytes | null;
  if ("tickets" in sealers) {
    const ticket = sealers.tickets[phase];
    const context = concatBytes(TICKET_SEAL, eta3, Uint8Array.of(ticket.attempt));
    output = checkSignature(author, header.seal, context, unsigned);
    if (!output || toHex(output) !== toHex(ticket.id)) return "bad_seal";
  } else {
    if (toHex(sealers.keys[phase]) !== toHex(author)) return "bad_seal"; // not this slot's
    output = checkSignature(author, header.seal, concatBytes(FALLBACK_SEAL, eta3), unsigned);
    if (!output) return "bad_seal";
  }
  const context = concatBytes(ENTROPY, output);
  const source = checkSignature(author, header.entropy_source, context, new Uint8Array(0));
  return source ? null : "bad_entropy_source";
}

/** X_F and X_E (GP §6): the contexts of a fallback seal and of the entropy source. */
const FALLBACK_SEAL = new TextEncoder().encode("jam_fallback_seal");
const ENTROPY = new TextEncoder().encode("jam_entropy");