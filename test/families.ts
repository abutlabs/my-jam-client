// The official test vectors, family by family, each run whole: your client's answer to a
// vector must be all of the vector's answer. bin/scoreboard.ts runs them and counts.

import assert from "node:assert/strict";
import type { Codec } from "../src/codec/codec.ts";
import { RefineContext, WorkItem, WorkPackage, WorkDigest, WorkReport } from "../src/work.ts";
import { checkCodecVector, vectorJson, accountEntries } from "./vectors.ts";
import type { Config } from "../src/config.ts";
import { TicketsExtrinsic, PreimagesExtrinsic, AssurancesExtrinsic, GuaranteesExtrinsic, DisputesExtrinsic, Header, Extrinsic, Block, EpochMark, TicketBody, TicketEnvelope, Assurance, Preimage } from "../src/block.ts";
import { FULL, TINY } from "../src/config.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import type { KeyValue } from "../src/trie.ts";
import { stateRoot } from "../src/trie.ts";
import { shuffleWithHash } from "../src/shuffle.ts";
import type { SafroleJson } from "../src/safrole.ts";
import { safroleError, safroleFromJson, safroleStep } from "../src/safrole.ts";
import { NewBlock, Recent, recordBlock, RecentBlock } from "../src/history.ts";
import { PendingReports, placeReports, reportedPackages } from "../src/cores.ts";
import { clearJudged, disputesError, judges, offendersMark, outcome, PastJudgements, recordOffenders, recordVerdicts } from "../src/disputes.ts";
import { ValidatorKey } from "../src/state.ts";
import { assuranceError, availableCores, clearCores, nowAvailable } from "../src/assurances.ts";
import { assignmentFor, guaranteeError, guarantorAssignments, reportError, reporters, signerKeys } from "../src/guarantors.ts";
import { AuthPools, AuthQueues, nextPools, UsedAuthorizer } from "../src/authorization.ts";
import { providePreimages } from "../src/services.ts";
import type { PreimagesAccount } from "./vectors.ts";
import { accumulateBlock, accumulationStateFromJson, outputsRoot } from "../src/accumulate.ts";
import type { AccumulationStateJson } from "../src/accumulate.ts";
import { updateValidatorStats, ValidatorStats, CoreStats, coreStats, ServiceStats, serviceStats } from "../src/statistics.ts";
import { importBlock } from "../src/import.ts";

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
  { folders: ["stf/assurances/tiny", "stf/assurances/full"], check: checkAssurances },
  { folders: ["stf/reports/tiny", "stf/reports/full"], check: checkReports },
  { folders: ["stf/authorizations/tiny", "stf/authorizations/full"], check: checkAuthorizations },
  { folders: ["stf/preimages/tiny", "stf/preimages/full"], check: checkPreimages },
  { folders: ["stf/accumulate/tiny", "stf/accumulate/full"], check: checkAccumulate },
  { folders: ["stf/statistics/tiny", "stf/statistics/full"], check: checkStatistics },
  {
    folders: [
      "traces/fallback", "traces/safrole", "traces/storage", "traces/storage_light",
      "traces/preimages", "traces/preimages_light", "traces/fuzzy", "traces/fuzzy_light",
    ],
    check: checkTrace,
  },
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

/** The size a vector is written for, from its folder: full or tiny. */
const configOf = (name: string): Config => (name.includes("/full/") ? FULL : TINY);

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

/** β as the history vectors write it: the blocks, and the belt's peaks as `mmr`. */
type Beta = { history: unknown[]; mmr: { peaks: unknown[] } };

/** A history vector: β′, the last eight blocks and the belt. It says nothing back. */
export function checkHistory(name: string) {
  const vector = vectorJson(name) as StfVector<unknown, { beta: Beta }>;
  const recent = (beta: Beta) => Recent.fromJson({ history: beta.history, belt: beta.mmr.peaks });
  const after = recordBlock(recent(vector.pre_state.beta), NewBlock.fromJson(vector.input));
  assert.deepEqual(after, recent(vector.post_state.beta), "beta differs");
  assert.equal(vector.output, null, "output differs");
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

type AssurancesInput = { assurances: unknown[]; slot: number; parent: string };
type AssurancesState = {
  avail_assignments: unknown;
  curr_validators: unknown[];
  post_validators: unknown[];
};

/** An assurances vector: 𝐑, the reports made available, and ρ‡, or the rule broken. */
function checkAssurances(name: string) {
  const vector = vectorJson(name) as StfVector<AssurancesInput, AssurancesState>;
  const config = configOf(name);
  const { input, pre_state } = vector;
  const cores = PendingReports(config).fromJson(pre_state.avail_assignments);
  const assurances = input.assurances.map((a) => Assurance(config).fromJson(a));
  const active = keys(pre_state.curr_validators);
  const ed25519 = active.map((k) => k.ed25519);
  const error = assuranceError(assurances, fromHex(input.parent), ed25519, cores);
  sameError(error, vector);
  if (error) return unchanged(vector, []);
  const ok = vector.output?.ok as { reported: unknown[] };
  const reported = ok.reported.map((r) => WorkReport.fromJson(r));
  assert.deepEqual(nowAvailable(cores, assurances, active.length), reported, "reported differs");
  const available = availableCores(cores, assurances, active.length);
  const resized = active.length !== pre_state.post_validators.length;
  const after = clearCores(cores, available, input.slot, resized);
  const expected = PendingReports(config).fromJson(vector.post_state.avail_assignments);
  assert.deepEqual(after, expected, "avail_assignments differs");
  unchanged(vector, ["avail_assignments"]);
}

type ReportsInput = { guarantees: unknown[]; slot: number; known_packages: string[] };
type ReportsState = {
  curr_validators: unknown[];
  prev_validators: unknown[];
  entropy: string[];
  offenders: string[];
  avail_assignments: unknown;
  auth_pools: string[][];
  recent_blocks: { history: unknown[] };
  accounts: { id: number; data: { service: { code_hash: string; min_item_gas: number } } }[];
  cores_statistics: unknown[];
  services_statistics: ServiceTallies;
};

/** A reports vector: ρ′, the reporters and the reported packages, and the work counted for
 * each core and service; or the rule broken. */
function checkReports(name: string) {
  const vector = vectorJson(name) as StfVector<ReportsInput, ReportsState>;
  const config = configOf(name);
  const { input, pre_state: pre } = vector;
  const offenders = pre.offenders.map(fromHex);
  const [active, previous] = [keys(pre.curr_validators), keys(pre.prev_validators)];
  const entropy = pre.entropy.map(fromHex);
  const assignments =
    guarantorAssignments(config, input.slot, entropy, active, previous, offenders);
  const guarantees = GuaranteesExtrinsic.fromJson(input.guarantees);
  const cores = PendingReports(config).fromJson(pre.avail_assignments);
  const pools = pre.auth_pools.map((pool) => pool.map(fromHex));
  const reports = guarantees.map((g) => g.report);
  const history = pre.recent_blocks.history.map((b) => RecentBlock.fromJson(b));
  const services = new Map(pre.accounts.map(({ id, data: { service } }) => [id, {
    code_hash: fromHex(service.code_hash),
    min_item_gas: BigInt(service.min_item_gas),
  }]));
  const known = new Set(input.known_packages);
  const count = active.length;
  const error = guaranteeError(config, guarantees, input.slot, assignments, cores, pools, count) ??
    reportError(reports, history, known, services);
  sameError(error, vector);
  if (error) return unchanged(vector, []);
  const after = placeReports(cores, guarantees, input.slot);
  const expected = PendingReports(config).fromJson(vector.post_state.avail_assignments);
  assert.deepEqual(after, expected, "avail_assignments differs");
  const signers = guarantees.flatMap((g) =>
    signerKeys(g, assignmentFor(config, input.slot, g.slot, assignments).keys));
  const ok = vector.output?.ok as { reporters: string[]; reported: unknown[] };
  assert.deepEqual(reporters(signers).map(toHex), ok.reporters, "reporters differs");
  const reported = reportedPackages(guarantees).map((p) => ({
    work_package_hash: toHex(p.hash),
    segment_tree_root: toHex(p.exports_root),
  }));
  assert.deepEqual(reported, ok.reported, "reported differs");
  const post = vector.post_state;
  const coreTallies = post.cores_statistics.map((c) => CoreStats.fromJson(c));
  assert.deepEqual(coreStats(config, reports, [], []), coreTallies, "cores_statistics differs");
  const serviceTally = serviceTallies(post.services_statistics);
  const serviceWork = serviceStats(reports, [], new Map());
  assert.deepEqual(serviceWork, serviceTally, "services_statistics differs");
  unchanged(vector, ["avail_assignments", "cores_statistics", "services_statistics"]);
}

type AuthorizationsInput = { slot: number; auths: unknown[] };
type AuthorizationsState = { auth_pools: unknown; auth_queues: unknown };

/** An authorizations vector: α′, every core's pool after the block. It says nothing back. */
export function checkAuthorizations(name: string) {
  const vector = vectorJson(name) as StfVector<AuthorizationsInput, AuthorizationsState>;
  const config = configOf(name);
  const { input, pre_state } = vector;
  const pools = AuthPools(config).fromJson(pre_state.auth_pools);
  const queues = AuthQueues(config).fromJson(pre_state.auth_queues);
  const used = input.auths.map((a) => UsedAuthorizer.fromJson(a));
  const after = nextPools(pools, queues, used, input.slot);
  const expected = AuthPools(config).fromJson(vector.post_state.auth_pools);
  assert.deepEqual(after, expected, "auth_pools differs");
  assert.equal(vector.output, null, "output differs");
  unchanged(vector, ["auth_pools"]);
}

type PreimagesInput = { preimages: unknown[]; slot: number };
type PreimagesState = { accounts: PreimagesAccount[]; statistics: ServiceTallies };

/** A preimages vector: δ′, each preimage stored and its request marked, and each service's
 * provided preimages counted. Your client refuses no preimages (lesson 14.1's simple road),
 * so it accepts every block. */
function checkPreimages(name: string) {
  const vector = vectorJson(name) as StfVector<PreimagesInput, PreimagesState>;
  const { input, pre_state } = vector;
  sameError(null, vector);
  const preimages = input.preimages.map((p) => Preimage.fromJson(p));
  const after = providePreimages(accountEntries(pre_state.accounts), preimages, input.slot);
  const sorted = after.sort((a, b) => toHex(a.key).localeCompare(toHex(b.key)));
  assert.deepEqual(sorted, accountEntries(vector.post_state.accounts), "accounts differs");
  const expected = serviceTallies(vector.post_state.statistics);
  assert.deepEqual(serviceStats([], preimages, new Map()), expected, "statistics differs");
  unchanged(vector, ["accounts", "statistics"]);
}

type AccumulateInput = { slot: number; reports: unknown[] };
type ServiceRecord = Record<string, number>;
type AccumulateStatistics = { id: number; record: ServiceRecord }[];
type AccumulateState = AccumulationStateJson & { statistics: AccumulateStatistics };

/** An accumulate vector: every account, the privileges, the queue and history, τ′, the
 * services' accumulation statistics, and the root of what services yielded. */
function checkAccumulate(name: string) {
  const vector = vectorJson(name) as StfVector<AccumulateInput, AccumulateState>;
  const config = configOf(name);
  const { input, pre_state, post_state } = vector;
  const reports = input.reports.map((r) => WorkReport.fromJson(r));
  const before = accumulationStateFromJson(pre_state);
  const { state, statistics, outputs } = accumulateBlock(config, before, input.slot, reports);
  assert.equal(toHex(outputsRoot(outputs)), vector.output?.ok, "output differs");
  const expected = accumulationStateFromJson(post_state);
  assert.deepEqual(state.accounts, expected.accounts, "accounts differs");
  assert.deepEqual(state.privileges, expected.privileges, "privileges differs");
  assert.deepEqual(state.free, expected.free, "privileges' always_acc differs");
  assert.deepEqual(state.ready, expected.ready, "ready_queue differs");
  assert.deepEqual(state.accumulated, expected.accumulated, "accumulated differs");
  assert.equal(input.slot, post_state.slot, "slot differs"); // τ′ is the block's slot
  const stats = post_state.statistics.map(({ id, record: r }) => [id, {
    count: r.accumulate_count,
    transfers: r.accumulate_transfer_count,
    gasUsed: BigInt(r.accumulate_gas_used),
  }] as const);
  assert.deepEqual(statistics, new Map(stats), "statistics differs");
  unchanged(vector, ["accounts", "privileges", "ready_queue", "accumulated", "slot", "statistics"]);
}

type StatsInput = { slot: number; author_index: number; extrinsic: unknown };
type StatsState = {
  slot: number;
  curr_validators: unknown[];
  vals_curr_stats: unknown[];
  vals_last_stats: unknown[];
};

/** One block of statistics vector `name`: the tallies before it, your code's after it,
 * and the vector's after it. */
export function runStats(name: string) {
  const vector = vectorJson(name) as StfVector<StatsInput, StatsState>;
  const config = configOf(name);
  const { input, pre_state: pre, post_state: post } = vector;
  const tallies = (json: unknown[]) => json.map((s) => ValidatorStats.fromJson(s));
  const current = tallies(pre.vals_curr_stats);
  const before = { slot: pre.slot, current, last: tallies(pre.vals_last_stats) };
  const extrinsic = Extrinsic(config).fromJson(input.extrinsic);
  const [author, validators] = [input.author_index, keys(pre.curr_validators)];
  const after = updateValidatorStats(config, before, input.slot, author, extrinsic, validators);
  const expected = { current: tallies(post.vals_curr_stats), last: tallies(post.vals_last_stats) };
  return { vector, before, after, expected };
}

/** A statistics vector: π_V and π_L after the block. It says nothing back. */
export function checkStatistics(name: string) {
  const { vector, after, expected } = runStats(name);
  assert.deepEqual(after, expected, "vals_curr_stats or vals_last_stats differs");
  assert.equal(vector.output, null, "output differs");
  unchanged(vector, ["vals_curr_stats", "vals_last_stats"]);
}

/** Service tallies as the vectors write them: a list of ids, each with its tally. */
type ServiceTallies = { id: number; record: unknown }[];

/** The vectors' service tallies, as a map from service id to tally. */
const serviceTallies = (json: ServiceTallies) =>
  new Map(json.map((s) => [s.id, ServiceStats.fromJson(s.record)]));

/** One step of a block-import trace: the state before, the block, the state after. */
type TraceStep = {
  pre_state: { state_root: string; keyvals: { key: string; value: string }[] };
  block: unknown;
  post_state: { state_root: string };
};

/** Block n of a trace, imported into the state before it: the state root it ends with (or
 * why it was refused), and the root the trace says comes next. */
export function importTrace(family: string, n: number) {
  const name = `traces/${family}/${String(n).padStart(8, "0")}.json`;
  const trace = vectorJson(name) as TraceStep;
  const before: KeyValue[] = trace.pre_state.keyvals.map((e) => ({
    key: fromHex(e.key),
    value: fromHex(e.value),
  }));
  const after = importBlock(TINY, before, Block(TINY).fromJson(trace.block));
  const root: string = "error" in after ? after.error : toHex(stateRoot(after));
  const refused = trace.post_state.state_root === trace.pre_state.state_root;
  return { root, expected: refused ? "refused" : trace.post_state.state_root, after };
}

/** A block-import trace step: the block imported to the trace's state root, or refused
 * when the trace refuses it, for whatever reason (a trace doesn't say which rule). */
function checkTrace(name: string) {
  const [, family, file] = name.split("/");
  const { root, expected, after } = importTrace(family, Number(file.replace(".json", "")));
  if (expected === "refused" && "error" in after) return;
  assert.equal(root, expected, `${root.slice(0, 18)}, not ${expected.slice(0, 18)}`);
}
