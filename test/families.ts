// The official test vectors, family by family, each run whole: your client's answer to a
// vector must be all of the vector's answer. bin/scoreboard.ts runs them and counts.

import assert from "node:assert/strict";
import type { Codec } from "../src/codec/codec.ts";
import { RefineContext, WorkItem, WorkPackage, WorkDigest, WorkReport } from "../src/work.ts";
import { checkCodecVector } from "./vectors.ts";
import type { Config } from "../src/config.ts";
import { TicketsExtrinsic, PreimagesExtrinsic, AssurancesExtrinsic, GuaranteesExtrinsic, DisputesExtrinsic, Header, Extrinsic, Block } from "../src/block.ts";
import { FULL, TINY } from "../src/config.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import type { KeyValue } from "../src/trie.ts";
import { stateRoot } from "../src/trie.ts";
import { vectorJson } from "./vectors.ts";
import { shuffleWithHash } from "../src/shuffle.ts";
import { EpochMark, TicketBody, TicketEnvelope } from "../src/block.ts";
import type { SafroleJson } from "../src/safrole.ts";
import { safroleError, safroleFromJson, safroleStep } from "../src/safrole.ts";
import { PendingReports } from "../src/cores.ts";
import { clearJudged, disputesError, judges, offendersMark, outcome, PastJudgements, recordOffenders, recordVerdicts } from "../src/disputes.ts";
import { ValidatorKey } from "../src/state.ts";

/** The size a vector is written for, from its folder: full or tiny. */
const configOf = (name: string): Config => (name.includes("/full/") ? FULL : TINY);

/** A family of official vectors: the folders of vectors/ it fills, and a check that runs
 * one vector whole and throws if your client's answer differs from it anywhere. */
export type Family = { folders: string[]; check: (name: string) => void };

/** Every family your client runs so far. */
export const FAMILIES: Family[] = [
  { folders: ["codec/tiny", "codec/full"], check: checkCodec },
  { folders: ["trie"], check: checkTrie },
  { folders: ["shuffle"], check: checkShuffle },
  { folders: ["stf/safrole/tiny", "stf/safrole/full"], check: checkSafrole },
  { folders: ["stf/history/tiny", "stf/history/full"], check: checkHistory },
  { folders: ["stf/disputes/tiny", "stf/disputes/full"], check: checkDisputes },
];

/** The codecs for the codec vectors, by the vectors' names for the structures. A codec
 * whose shape depends on the size comes as a function of the config. */
const CODECS: Record<string, Codec<unknown> | ((config: Config) => Codec<unknown>)> = {
  refine_context: RefineContext,
  work_item: WorkItem,
  work_package: WorkPackage,
  work_result_0: WorkDigest,
  work_result_1: WorkDigest,
  work_report: WorkReport,
  tickets_extrinsic: TicketsExtrinsic,
  preimages_extrinsic: PreimagesExtrinsic,
  assurances_extrinsic: AssurancesExtrinsic,
  guarantees_extrinsic: GuaranteesExtrinsic,
  disputes_extrinsic: DisputesExtrinsic,
  header_0: Header,
  header_1: Header,
  extrinsic: Extrinsic,
  block: Block,
};

/** A codec vector, such as "codec/tiny/work_item.json", by its round trip. */
function checkCodec(name: string) {
  const structure = name.split("/").at(-1)!.replace(".json", "");
  const codec = CODECS[structure];
  assert.ok(codec, `no codec for ${structure} yet`);
  const sized = typeof codec === "function" ? codec(configOf(name)) : codec;
  checkCodecVector(sized, name.replace(".json", ""));
}

/** The trie vector: each set of entries has the vector's root. Its keys are 32 bytes, from
 * when the Gray Paper's keys were; the trie reads the first 31. */
export function checkTrie(name: string) {
  const cases = vectorJson(name) as { input: Record<string, string>; output: string }[];
  for (const { input, output } of cases) {
    const entries: KeyValue[] = Object.entries(input).map(([key, value]) => ({
      key: fromHex(`0x${key}`).subarray(0, 31),
      value: fromHex(`0x${value}`),
    }));
    assert.equal(toHex(stateRoot(entries)), `0x${output}`);
  }
}

/** The shuffle vector: 0, 1, 2… shuffled by each case's hash, in the vector's order. */
export function checkShuffle(name: string) {
  const cases = vectorJson(name) as { input: number; entropy: string; output: number[] }[];
  for (const { input, entropy, output } of cases) {
    const items: number[] = Array.from({ length: input }, (_, i) => i);
    assert.deepEqual(shuffleWithHash(items, fromHex(`0x${entropy}`)), output);
  }
}

/** A state-transition vector: the input, the state before and after, and the output. */
type StfVector<Input, State> = {
  input: Input;
  pre_state: State;
  post_state: State;
  output: { ok?: unknown; err?: string } | null;
};

/** Your client's error for a vector's block, or null: the vector's, or null if it has none. */
function sameError(error: string | null, vector: StfVector<unknown, object>) {
  const expected = vector.output?.err ?? null;
  assert.equal(error, expected, `${error ?? "accepted"}, not ${expected ?? "accepted"}`);
}

/** The parts of a vector's state your client didn't make: each must be as it was before.
 * A refused block makes nothing, so all of its state stays. */
function unchanged(vector: StfVector<unknown, object>, made: string[]) {
  const before = vector.pre_state as Record<string, unknown>;
  const after = vector.post_state as Record<string, unknown>;
  for (const key of Object.keys(after)) {
    if (!made.includes(key)) assert.deepEqual(after[key], before[key], `${key} changed`);
  }
}

type SafroleInput = { slot: number; entropy: string; extrinsic: unknown[] };
type SafroleVector = StfVector<SafroleInput, SafroleJson & { post_offenders: string[] }>;

/** A Safrole vector: τ′, η′, the four validator sets, the lottery, the sealers and the ring
 * root, and the header's two marks. */
function checkSafrole(name: string) {
  const vector = vectorJson(name) as SafroleVector;
  const config = configOf(name);
  const { input, pre_state } = vector;
  const before = safroleFromJson(pre_state);
  const tickets = input.extrinsic.map((t) => TicketEnvelope.fromJson(t));
  const offenders = pre_state.post_offenders.map(fromHex);
  const error = safroleError(config, before, input.slot, tickets, offenders);
  sameError(error, vector);
  if (error) return unchanged(vector, []);
  const vrfOutput = fromHex(input.entropy);
  const step = safroleStep(config, before, input.slot, vrfOutput, offenders, tickets);
  assert.deepEqual(step.after, safroleFromJson(vector.post_state), "the state after differs");
  const ok = vector.output?.ok as { epoch_mark: unknown; tickets_mark: unknown[] | null };
  const epochMark = ok.epoch_mark ? EpochMark.fromJson(ok.epoch_mark) : null;
  assert.deepEqual(step.epochMark, epochMark, "epoch_mark differs");
  const ticketsMark = ok.tickets_mark?.map((t) => TicketBody.fromJson(t)) ?? null;
  assert.deepEqual(step.ticketsMark, ticketsMark, "tickets_mark differs");
  unchanged(vector, [
    "tau", "eta", "iota", "gamma_k", "kappa", "lambda", "gamma_a", "gamma_s", "gamma_z",
  ]);
}

/** Validator keys from a vector's JSON. */
const keys = (json: unknown[]) => json.map((key) => ValidatorKey.fromJson(key));

type DisputesState = {
  psi: unknown;
  rho: unknown;
  tau: number;
  kappa: unknown[];
  lambda: unknown[];
};

/** A disputes vector: ψ′, ρ† and the offenders mark, or the rule a refused block breaks. */
function checkDisputes(name: string) {
  const vector = vectorJson(name) as StfVector<{ disputes: unknown }, DisputesState>;
  const config = configOf(name);
  const { input, pre_state } = vector;
  const disputes = DisputesExtrinsic.fromJson(input.disputes);
  const psi = PastJudgements.fromJson(pre_state.psi);
  const [active, previous] = [keys(pre_state.kappa), keys(pre_state.lambda)];
  const error = disputesError(config, disputes, psi, pre_state.tau, active, previous);
  sameError(error, vector);
  if (error) return unchanged(vector, []);
  const judged = disputes.verdicts.map((v) => ({
    target: v.target,
    outcome: outcome(v, judges(config, pre_state.tau, v.age, active, previous).length),
  }));
  const after = recordOffenders(recordVerdicts(psi, judged), disputes);
  assert.deepEqual(after, PastJudgements.fromJson(vector.post_state.psi), "psi differs");
  const cores = PendingReports(config);
  const cleared = clearJudged(cores.fromJson(pre_state.rho), judged);
  assert.deepEqual(cleared, cores.fromJson(vector.post_state.rho), "rho differs");
  const ok = vector.output?.ok as { offenders_mark: string[] };
  assert.deepEqual(offendersMark(disputes).map(toHex), ok.offenders_mark, "offenders_mark differs");
  unchanged(vector, ["psi", "rho"]);
}

function checkHistory(name: string): void {
  throw new Error("Function not implemented.");
}
