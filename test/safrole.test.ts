import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex } from "../src/bytes.ts";
import type { Config } from "../src/config.ts";
import { FULL, TINY } from "../src/config.ts";
import { epochOf } from "../src/epoch.ts";
import type { ValidatorSets, Safrole } from "../src/safrole.ts";
import { nextEntropy, rotateValidators, fallbackKeys, outsideIn, sealedByTickets, ticketsMark, safroleFromJson, safroleStep } from "../src/safrole.ts";
import { ValidatorKey } from "../src/state.ts";
import { vectorFiles, vectorJson } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";
import { TicketBody, EpochMark } from "../src/block.ts";

/** The parts of a safrole vector's state the lessons use so far. */
type SafroleState = {
  tau: number;
  eta: string[];
  iota: unknown[];
  gamma_k: unknown[];
  kappa: unknown[];
  lambda: unknown[];
  post_offenders: string[];
  gamma_a: unknown[]; // γ_A: the lottery's best tickets so far
  gamma_s: { keys?: string[]; tickets?: unknown[] }; // γ_S: the sealers, keys or tickets
};

/** A safrole test vector: the parts of it the lessons use so far. */
type SafroleVector = {
  input: { slot: number; entropy: string; extrinsic: unknown[] }; // extrinsic: tickets
  pre_state: SafroleState;
  post_state: SafroleState;
  output: { err?: string; ok?: { epoch_mark: unknown; tickets_mark: unknown[] | null } };
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

test("F: an epoch without a full lottery is sealed by keys picked from κ′ by hash", () => {
  let fallbacks = 0;
  for (const { config, name, vector, newEpoch } of acceptedVectors()) {
    const { input, pre_state, post_state } = vector;
    if (!newEpoch || !post_state.gamma_s.keys) continue; // not a fallback epoch
    const vrfOutput: Bytes = fromHex(input.entropy);
    const eta: Bytes[] = nextEntropy(pre_state.eta.map(fromHex), vrfOutput, newEpoch);
    const offenders: Bytes[] = pre_state.post_offenders.map(fromHex);
    const before: ValidatorSets = validatorSets(pre_state);
    const { active }: ValidatorSets = rotateValidators(before, offenders); // κ′
    const sealers: Bytes[] = fallbackKeys(config, eta[2], active); // F(η′₂, κ′)
    const sealersHex: string[] = sealers.map(toHex);
    assert.deepEqual(sealersHex, post_state.gamma_s.keys, name);
    fallbacks++;
  }
  assert.equal(fallbacks, 12); // 5 tiny, 7 full
});

test("Z: outside in, from both ends to the middle", () => {
  const odd: number[] = outsideIn([1, 2, 3, 4, 5]);
  assert.deepEqual(odd, [1, 5, 2, 4, 3]);
  const even: number[] = outsideIn([1, 2, 3, 4]);
  assert.deepEqual(even, [1, 4, 2, 3]);
});

/** Tickets from a vector's JSON. */
const tickets = (json: unknown[]) => json.map((ticket) => TicketBody.fromJson(ticket));

test("the lottery closes as phase Y is reached: slot 9 → 10 on tiny, but not 10 → 11", () => {
  const full: TicketBody[] = Array.from({ length: 12 }, () => ({
    id: new Uint8Array(32),
    attempt: 0,
  }));
  const closing: TicketBody[] | null = ticketsMark(TINY, 9, 10, full);
  assert.notEqual(closing, null);
  const closedAlready: TicketBody[] | null = ticketsMark(TINY, 10, 11, full);
  assert.equal(closedAlready, null);
  const notFull: TicketBody[] | null = ticketsMark(TINY, 9, 10, full.slice(1));
  assert.equal(notFull, null);
});

test("the tickets mark: in the block that closes a full lottery, and in no other", () => {
  let marks = 0;
  for (const { config, name, vector } of acceptedVectors()) {
    const { input, pre_state, output } = vector;
    const accumulator: TicketBody[] = tickets(pre_state.gamma_a);
    const mark: TicketBody[] | null = ticketsMark(config, pre_state.tau, input.slot, accumulator);
    const markJson = output.ok?.tickets_mark;
    const expected: TicketBody[] | null = markJson ? tickets(markJson) : null;
    assert.deepEqual(mark, expected, name);
    if (mark) marks++;
  }
  assert.equal(marks, 2); // 1 tiny, 1 full
});

test("γ′_S: a new epoch is sealed by the winners, outside in, if the lottery closed full", () => {
  let ticketed = 0;
  for (const { config, name, vector, newEpoch } of acceptedVectors()) {
    if (!newEpoch) continue;
    const { input, pre_state, post_state } = vector;
    const accumulator: TicketBody[] = tickets(pre_state.gamma_a);
    const closedFull: boolean = sealedByTickets(config, pre_state.tau, input.slot, accumulator);
    if (closedFull) {
      const sealers: TicketBody[] = tickets(post_state.gamma_s.tickets ?? []);
      const winners: TicketBody[] = outsideIn(accumulator);
      assert.deepEqual(sealers, winners, name);
      ticketed++;
    } else {
      assert.ok(post_state.gamma_s.keys, name); // the fallback, as in lesson 8.3
    }
  }
  assert.equal(ticketed, 2); // 1 tiny, 1 full
});

test("a whole step of Safrole: the state and both marks, for each block without tickets", () => {
  let steps = 0;
  for (const { config, name, vector } of acceptedVectors()) {
    const { input, pre_state, post_state, output } = vector;
    if (input.extrinsic.length > 0) continue; // reading tickets needs Bandersnatch
    const vrfOutput: Bytes = fromHex(input.entropy);
    const offenders: Bytes[] = pre_state.post_offenders.map(fromHex);
    const before: Safrole = safroleFromJson(pre_state);
    const step = safroleStep(config, before, input.slot, vrfOutput, offenders);
    const after: Safrole = safroleFromJson(post_state);
    assert.deepEqual(step.after, after, name);
    const epochMarkJson = output.ok?.epoch_mark;
    const ticketsMarkJson = output.ok?.tickets_mark;
    const epochMark: EpochMark | null = epochMarkJson ? EpochMark.fromJson(epochMarkJson) : null;
    assert.deepEqual(step.epochMark, epochMark, name);
    const ticketsMark: TicketBody[] | null = ticketsMarkJson ? tickets(ticketsMarkJson) : null;
    assert.deepEqual(step.ticketsMark, ticketsMark, name);
    steps++;
  }
  assert.equal(steps, 22); // 10 tiny, 12 full
});