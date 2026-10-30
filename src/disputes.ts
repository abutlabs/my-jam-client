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
