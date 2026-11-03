import { test } from "node:test";
import assert from "node:assert/strict";
import { DisputesExtrinsic } from "../src/block.ts";
import type { Verdict } from "../src/block.ts";
import { FULL, TINY } from "../src/config.ts";
import { judges, outcome, PastJudgements, recordVerdicts, votesSigned, culpritSigned, faultSigned, offendersMark, recordOffenders, clearJudged, verdictError, disputesError } from "../src/disputes.ts";
import { ValidatorKey } from "../src/state.ts";
import { vectorFiles, vectorJson } from "./vectors.ts";
import type { Outcome } from "../src/disputes.ts";
import { toHex } from "../src/bytes.ts";
import type { Bytes } from "../src/bytes.ts";
import { PendingReports } from "../src/cores.ts";
import type { PendingReport } from "../src/cores.ts";
import { encode } from "../src/codec/codec.ts";
import { blake2b256 } from "../src/hash.ts";
import { WorkReport } from "../src/work.ts";

/** A verdict with `valid` "valid" votes out of `count`, unsigned: enough for counting. */
function verdictWith(valid: number, count: number): Verdict {
  const votes = Array.from({ length: count }, (_, index) => ({
    vote: index < valid,
    index,
    signature: new Uint8Array(64),
  }));
  return { target: new Uint8Array(32), age: 0, votes };
}

test("V: with 6 judges, 5 valid votes is good, 0 is bad, 2 is wonky", () => {
  const fiveValid: Outcome = outcome(verdictWith(5, 5), 6);
  assert.equal(fiveValid, "good"); // ⌊2 × 6 / 3⌋ + 1 = 5
  const noneValid: Outcome = outcome(verdictWith(0, 5), 6);
  assert.equal(noneValid, "bad");
  const twoValid: Outcome = outcome(verdictWith(2, 5), 6);
  assert.equal(twoValid, "wonky"); // ⌊6 / 3⌋ = 2
});

/** A disputes test vector: the parts of it this lesson uses. */
type DisputesVector = {
  input: { disputes: unknown };
  pre_state: {
    psi: unknown; // ψ: past judgements: good, bad and wonky report hashes, and the offenders
    tau: number; // τ: the time: the slot of the most recent block
    kappa: unknown[]; // κ: the validators now: the judges of a verdict from this epoch
    lambda: unknown[]; // λ: last epoch's validators: the judges of a verdict from the last
    rho: unknown; // ρ: the cores: the report each holds while its data becomes available
  };
  post_state: {
    psi: unknown; // ψ′: past judgements after the block: each verdict's report filed
    rho: unknown; // ρ†: the cores after the judgements: bad and wonky reports gone
  };
  output: { err?: string; ok?: { offenders_mark: string[] } };
};

/** A disputes vector's verdicts, each with its judges' keys (κ or λ, by its age). */
function judgedVerdicts(config: typeof TINY, vector: DisputesVector) {
  const { input, pre_state } = vector;
  const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
  const [active, previous] = [keys(pre_state.kappa), keys(pre_state.lambda)];
  return DisputesExtrinsic.fromJson(input.disputes).verdicts.map((verdict) => ({
    verdict,
    keys: judges(config, pre_state.tau, verdict.age, active, previous),
  }));
}

/** The accepted disputes vectors of a size: a rejected block changes nothing. */
function acceptedVectors(config: typeof TINY): { name: string; vector: DisputesVector }[] {
  return vectorFiles(`stf/disputes/${config.name}`)
    .map((name) => ({ name, vector: vectorJson(name) as DisputesVector }))
    .filter(({ vector }) => !vector.output.err);
}

test("every vote is signed by its judge (tiny: full verdicts are 683 votes each)", () => {
  for (const { name, vector } of acceptedVectors(TINY)) {
    for (const { verdict, keys } of judgedVerdicts(TINY, vector)) {
      const signed: boolean = votesSigned(verdict, keys);
      assert.ok(signed, name);
    }
  }
});

test("each judged report joins the set of its verdict's outcome", () => {
  let accepted = 0;
  for (const config of [TINY, FULL]) {
    for (const { name, vector } of acceptedVectors(config)) {
      const outcomes = judgedVerdicts(config, vector).map(({ verdict, keys }) => ({
        target: verdict.target,
        outcome: outcome(verdict, keys.length),
      }));
      const before: PastJudgements = PastJudgements.fromJson(vector.pre_state.psi);
      const after: PastJudgements = recordVerdicts(before, outcomes);
      const { good, bad, wonky }: PastJudgements = PastJudgements.fromJson(vector.post_state.psi);
      assert.deepEqual([after.good, after.bad, after.wonky], [good, bad, wonky], name);
      accepted++;
    }
  }
  assert.equal(accepted, 21); // 10 tiny, 11 full
});

test("a forged vote is caught", () => {
  const vector = vectorJson("stf/disputes/tiny/progress_with_bad_signatures-1.json");
  const [{ verdict, keys }] = judgedVerdicts(TINY, vector as DisputesVector);
  const signed: boolean = votesSigned(verdict, keys);
  assert.equal(signed, false);
});

test("every culprit's guarantee and every fault's vote is really theirs", () => {
  for (const config of [TINY, FULL]) {
    for (const { name, vector } of acceptedVectors(config)) {
      const { culprits, faults } = DisputesExtrinsic.fromJson(vector.input.disputes);
      for (const culprit of culprits) {
        const signed: boolean = culpritSigned(culprit);
        assert.ok(signed, name);
      }
      for (const fault of faults) {
        const signed: boolean = faultSigned(fault);
        assert.ok(signed, name);
      }
    }
  }
});

test("a forged guarantee is caught", () => {
  const vector = vectorJson("stf/disputes/tiny/progress_with_bad_signatures-2.json");
  const { culprits } = DisputesExtrinsic.fromJson((vector as DisputesVector).input.disputes);
  const signed: boolean[] = culprits.map(culpritSigned);
  assert.deepEqual(signed, [true, false]);
});

test("the offenders mark names this block's offenders, and ψ′_O keeps them all", () => {
  let offenders = 0;
  for (const config of [TINY, FULL]) {
    for (const { name, vector } of acceptedVectors(config)) {
      const disputes: DisputesExtrinsic = DisputesExtrinsic.fromJson(vector.input.disputes);
      const mark: Bytes[] = offendersMark(disputes);
      const markHex: string[] = mark.map(toHex);
      assert.deepEqual(markHex, vector.output.ok?.offenders_mark, name);
      const before: PastJudgements = PastJudgements.fromJson(vector.pre_state.psi);
      const after: PastJudgements = recordOffenders(before, disputes);
      const expected: PastJudgements = PastJudgements.fromJson(vector.post_state.psi);
      assert.deepEqual(after.offenders, expected.offenders, name);
      offenders += mark.length;
    }
  }
  assert.equal(offenders, 28); // 14 tiny, 14 full
});

test("ρ†: a report judged bad or wonky is taken off its core", () => {
  let cleared = 0;
  for (const config of [TINY, FULL]) {
    for (const { name, vector } of acceptedVectors(config)) {
      const judged = judgedVerdicts(config, vector).map(({ verdict, keys }) => ({
        target: verdict.target,
        outcome: outcome(verdict, keys.length),
      }));
      const cores = PendingReports(config);
      const before: (PendingReport | null)[] = cores.fromJson(vector.pre_state.rho);
      const after: (PendingReport | null)[] = clearJudged(before, judged);
      const expected: (PendingReport | null)[] = cores.fromJson(vector.post_state.rho);
      assert.deepEqual(after, expected, name);
      cleared += before.filter((p) => p !== null).length - after.filter((p) => p !== null).length;
    }
  }
  assert.equal(cleared, 2); // one core on tiny, one on full
});

test("ρ†: wonky clears a core too, and good leaves it be", () => {
  const vector = vectorJson("stf/disputes/tiny/progress_invalidates_avail_assignments-1.json");
  const cores: (PendingReport | null)[] = PendingReports(TINY).fromJson(
    (vector as DisputesVector).pre_state.rho,
  );
  const pending: PendingReport = cores[0] as PendingReport; // core 0 holds a report
  const target: Bytes = blake2b256(encode(WorkReport, pending.guarantee.report));
  const afterWonky: PendingReport | null = clearJudged(cores, [{ target, outcome: "wonky" }])[0];
  assert.equal(afterWonky, null);
  const afterGood: PendingReport | null = clearJudged(cores, [{ target, outcome: "good" }])[0];
  assert.equal(afterGood, pending);
});

/** What the verdict rules say of disputes vector `name`: null (they pass) or the rule broken. */
function verdictVerdict(config: typeof TINY, name: string) {
  const { input, pre_state } = vectorJson(name) as DisputesVector;
  const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
  const { verdicts } = DisputesExtrinsic.fromJson(input.disputes);
  const before = PastJudgements.fromJson(pre_state.psi);
  const [active, previous] = [keys(pre_state.kappa), keys(pre_state.lambda)];
  return verdictError(config, verdicts, before, pre_state.tau, active, previous);
}

/** The disputes vectors whose verdicts break a rule, and the rule they break. */
const BAD_VERDICTS = new Map([
  ["progress_with_verdicts-3", "verdicts_not_sorted_unique"],
  ["progress_with_culprits-3", "already_judged"],
  ["progress_with_faults-5", "already_judged"],
  ["progress_with_verdict_signatures_from_previous_set-2", "bad_judgement_age"],
  ["progress_with_bad_votes_count-1", "bad_votes_count"],
  ["progress_with_verdicts_from_resized_previous_set-2", "bad_votes_count"], // full only
  ["progress_with_verdicts-1", "judgements_not_sorted_unique"],
  ["progress_with_verdicts-2", "judgements_not_sorted_unique"],
  ["progress_with_bad_signatures-1", "bad_signature"],
  ["progress_with_verdicts-5", "bad_vote_split"],
]);

test("a split that's neither good, bad nor wonky is refused", () => {
  const name = "stf/disputes/tiny/progress_with_verdicts-5.json";
  const broken: string | null = verdictVerdict(TINY, name);
  assert.equal(broken, "bad_vote_split");
});

/**
 * Every tiny disputes vector, and the full ones tiny can't have (a resized λ). A full
 * verdict carries 683 signed votes, and checking every full vector takes the better part
 * of a minute; `npm run check-disputes full` does that whenever you like.
 */
const VERDICT_VECTORS = [
  ...vectorFiles("stf/disputes/tiny").map((name) => ({ config: TINY, name })),
  ...vectorFiles("stf/disputes/full")
    .filter((name) => name.includes("resized"))
    .map((name) => ({ config: FULL, name })),
];

for (const { config, name } of VERDICT_VECTORS) {
  const short = name.split("/").at(-1)!.replace(".json", "");
  test(`${name}: its verdicts pass, or break the rule the vector names`, () => {
    const broken: string | null = verdictVerdict(config, name);
    const expected: string | null = BAD_VERDICTS.get(short) ?? null;
    assert.equal(broken, expected);
  });
}

/** What every disputes rule says of vector `name`: null (accepted) or the rule broken. */
function disputesVerdict(config: typeof TINY, name: string) {
  const { input, pre_state } = vectorJson(name) as DisputesVector;
  const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
  const disputes = DisputesExtrinsic.fromJson(input.disputes);
  const before = PastJudgements.fromJson(pre_state.psi);
  const [active, previous] = [keys(pre_state.kappa), keys(pre_state.lambda)];
  return disputesError(config, disputes, before, pre_state.tau, active, previous);
}

test("a fault must have voted against the verdict", () => {
  const name = "stf/disputes/tiny/progress_with_faults-7.json";
  const broken: string | null = disputesVerdict(TINY, name);
  assert.equal(broken, "fault_verdict_wrong");
});

for (const { config, name } of VERDICT_VECTORS) {
  test(`${name}: accepted or refused, as the vector says`, () => {
    const { output } = vectorJson(name) as DisputesVector;
    const broken: string | null = disputesVerdict(config, name);
    const expected: string | null = output.err ?? null;
    assert.equal(broken, expected);
  });
}
