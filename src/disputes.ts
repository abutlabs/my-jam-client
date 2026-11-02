// Disputes (GP §10): when a work-report is challenged, validators vote on it, and the chain
// records the verdict for good.

import type { Verdict, Culprit, DisputesExtrinsic, Fault } from "./block.ts";
import type { Bytes } from "./bytes.ts";
import { concatBytes, toHex } from "./bytes.ts";
import type { Value } from "./codec/codec.ts";
import { fixedBytes, hash, record, seq } from "./codec/codec.ts";
import type { Config } from "./config.ts";
import { epochOf } from "./epoch.ts";
import { verifyEd25519 } from "./signature.ts";
import type { ValidatorKey } from "./state.ts";
import { encode } from "./codec/codec.ts";
import type { PendingReport } from "./cores.ts";
import { blake2b256 } from "./hash.ts";
import { WorkReport } from "./work.ts";

/** ψ, C(5): the reports judged good, bad or wonky so far, and the offenders' Ed25519 keys. */
export const PastJudgements = record({
  good: seq(hash),
  bad: seq(hash),
  wonky: seq(hash),
  offenders: seq(fixedBytes(32)),
});
export type PastJudgements = Value<typeof PastJudgements>;

/** X_⊺ and X_⊥: "$jam_valid" and "$jam_invalid" in the GP. */
const VALID = new TextEncoder().encode("jam_valid");
const INVALID = new TextEncoder().encode("jam_invalid");

/** What a vote signs: its prefix, valid or invalid, then the report's hash. */
export function voteMessage(vote: boolean, target: Bytes): Bytes {
  return concatBytes(vote ? VALID : INVALID, target);
}

/** K: whose keys a verdict's votes are signed with. κ if its age is this epoch, else λ. */
export function judges(
  config: Config,
  time: number, // τ
  age: number, // the verdict's epoch
  active: ValidatorKey[], // κ
  previous: ValidatorKey[], // λ
): ValidatorKey[] {
  return age === epochOf(config, time) ? active : previous;
}

/** Whether every vote of a verdict is signed by the validator it names. */
export function votesSigned(verdict: Verdict, keys: ValidatorKey[]): boolean {
  return verdict.votes.every((vote) => {
    const message = voteMessage(vote.vote, verdict.target);
    return verifyEd25519(keys[vote.index].ed25519, message, vote.signature);
  });
}

/** A verdict's outcome: the report is good, bad, or wonky (nobody can tell). */
export type Outcome = "good" | "bad" | "wonky";

/** V: a verdict's outcome, by how many of its judges said "valid": all, none, or a third. */
export function outcome(verdict: Verdict, judges: number): Outcome {
  const valid = verdict.votes.filter((vote) => vote.vote).length;
  if (valid === Math.floor((2 * judges) / 3) + 1) return "good";
  if (valid === 0) return "bad";
  return "wonky"; // ⌊judges / 3⌋ said "valid": no side won
}

/** Hashes as a set: sorted, the way the state keeps them. */
const sorted = (hashes: Bytes[]) => [...hashes].sort((a, b) => toHex(a).localeCompare(toHex(b)));

/** ψ′'s three sets: each judged report joins the set of its outcome. */
export function recordVerdicts(
  before: PastJudgements,
  judged: { target: Bytes; outcome: Outcome }[],
): PastJudgements {
  const after = { ...before };
  for (const set of ["good", "bad", "wonky"] as const) {
    const reports = judged.filter((j) => j.outcome === set).map((j) => j.target);
    after[set] = sorted([...before[set], ...reports]);
  }
  return after;
}

/** X_G: "$jam_guarantee" in the GP, what a guarantor signs before a report's hash. */
const GUARANTEE = new TextEncoder().encode("jam_guarantee");

/** Whether a culprit's signature really is its guarantee of the report: the evidence. */
export function culpritSigned(culprit: Culprit): boolean {
  return verifyEd25519(culprit.key, concatBytes(GUARANTEE, culprit.target), culprit.signature);
}

/** Whether a fault's signature really is its vote on the report, the way it voted. */
export function faultSigned(fault: Fault): boolean {
  return verifyEd25519(fault.key, voteMessage(fault.vote, fault.target), fault.signature);
}

/** H_O, the offenders mark: the keys of this block's offenders, culprits first, then faults. */
export function offendersMark(disputes: DisputesExtrinsic): Bytes[] {
  return [...disputes.culprits.map((c) => c.key), ...disputes.faults.map((f) => f.key)];
}

/** ψ′_O: the offenders so far, and this block's. */
export function recordOffenders(
  before: PastJudgements,
  disputes: DisputesExtrinsic,
): PastJudgements {
  return { ...before, offenders: sorted([...before.offenders, ...offendersMark(disputes)]) };
}

/** ρ† (GP §10): take every report judged bad or wonky off its core. */
export function clearJudged(
  cores: (PendingReport | null)[],
  judged: { target: Bytes; outcome: Outcome }[],
): (PendingReport | null)[] {
  const condemned = new Set(judged.filter((j) => j.outcome !== "good").map((j) => toHex(j.target)));
  return cores.map((pending) => {
    if (pending === null) return null;
    const report = blake2b256(encode(WorkReport, pending.guarantee.report)); // as in lesson 5.2
    return condemned.has(toHex(report)) ? null : pending;
  });
}

/**
 * Are a block's verdicts valid (GP §10)? The first rule they break, under the test vectors'
 * name for it, or null if they keep every rule. `time` is τ, the slot before the block;
 * `active` and `previous` are κ and λ.
 */
export function verdictError(
  config: Config,
  verdicts: Verdict[],
  before: PastJudgements, // ψ
  time: number,
  active: ValidatorKey[],
  previous: ValidatorKey[],
): string | null {
  const epoch = epochOf(config, time);
  const keysOf = (v: Verdict) => judges(config, time, v.age, active, previous); // K
  const judged = new Set([...before.good, ...before.bad, ...before.wonky].map(toHex));
  const targetsInOrder = verdicts.every(
    (v, i) => i === 0 || toHex(verdicts[i - 1].target) < toHex(v.target),
  );
  const votesInOrder = (v: Verdict) =>
    v.votes.every((j, i) => i === 0 || v.votes[i - 1].index < j.index);
  const twoThirdsPlusOne = (v: Verdict) => Math.floor((2 * keysOf(v).length) / 3) + 1;
  const signed = (v: Verdict) =>
    v.votes.every((j) => j.index < keysOf(v).length) && votesSigned(v, keysOf(v));
  const split = (v: Verdict) => {
    const valid = v.votes.filter((j) => j.vote).length;
    return [twoThirdsPlusOne(v), 0, Math.floor(keysOf(v).length / 3)].includes(valid);
  };
  if (!targetsInOrder) return "verdicts_not_sorted_unique";
  if (verdicts.some((v) => judged.has(toHex(v.target)))) return "already_judged";
  if (!verdicts.every((v) => v.age === epoch || v.age === epoch - 1)) return "bad_judgement_age";
  if (!verdicts.every((v) => v.votes.length === twoThirdsPlusOne(v))) return "bad_votes_count";
  if (!verdicts.every(votesInOrder)) return "judgements_not_sorted_unique";
  if (!verdicts.every(signed)) return "bad_signature";
  if (!verdicts.every(split)) return "bad_vote_split";
  return null;
}

/**
 * Are a block's culprits and faults valid (GP §10)? The first rule they break, under the
 * test vectors' name for it, or null. Its verdicts are taken as valid: `verdictError`
 * comes first.
 */
export function offenseError(
  config: Config,
  disputes: DisputesExtrinsic,
  before: PastJudgements, // ψ
  time: number,
  active: ValidatorKey[],
  previous: ValidatorKey[],
): string | null {
  const { verdicts, culprits, faults } = disputes;
  const judged = verdicts.map((v) => ({
    target: v.target,
    outcome: outcome(v, judges(config, time, v.age, active, previous).length),
  }));
  const after = recordVerdicts(before, judged); // ψ′
  const [bad, good] = [new Set(after.bad.map(toHex)), new Set(after.good.map(toHex))];
  const validators = new Set([...active, ...previous].map((k) => toHex(k.ed25519))); // κ ∪ λ
  const punished = new Set(before.offenders.map(toHex)); // ψ_O
  const byKey = (list: { key: Bytes }[]) =>
    list.every((x, i) => i === 0 || toHex(list[i - 1].key) < toHex(x.key));
  const known = (x: { key: Bytes }) => validators.has(toHex(x.key));
  const fresh = (x: { key: Bytes }) => !punished.has(toHex(x.key));
  const wrong = (f: Fault) => (f.vote ? bad : good).has(toHex(f.target)); // voted against it
  const faulted = (target: Bytes) => faults.some((f) => toHex(f.target) === toHex(target));
  if (!byKey(culprits)) return "culprits_not_sorted_unique";
  if (!culprits.every((c) => bad.has(toHex(c.target)))) return "culprits_verdict_not_bad";
  if (!culprits.every(known)) return "bad_guarantor_key";
  if (!culprits.every(fresh)) return "offender_already_reported";
  if (!culprits.every(culpritSigned)) return "bad_signature";
  if (!byKey(faults)) return "faults_not_sorted_unique";
  if (!faults.every(wrong)) return "fault_verdict_wrong";
  if (!faults.every(known)) return "bad_auditor_key";
  if (!faults.every(fresh)) return "offender_already_reported";
  if (!faults.every(faultSigned)) return "bad_signature";
  if (!judged.every((j) => j.outcome !== "good" || faulted(j.target))) return "not_enough_faults";
  return null;
}

/** Every disputes rule (GP §10): the verdicts' first (lesson 10.4), then the offenders'. */
export function disputesError(
  config: Config,
  disputes: DisputesExtrinsic,
  before: PastJudgements,
  time: number,
  active: ValidatorKey[],
  previous: ValidatorKey[],
): string | null {
  const verdicts = verdictError(config, disputes.verdicts, before, time, active, previous);
  return verdicts ?? offenseError(config, disputes, before, time, active, previous);
}