import { test } from "node:test";
import assert from "node:assert/strict";
import { DisputesExtrinsic } from "../src/block.ts";
import type { Verdict } from "../src/block.ts";
import { FULL, TINY } from "../src/config.ts";
import { judges, outcome, PastJudgements, recordVerdicts, votesSigned, culpritSigned, faultSigned, offendersMark, recordOffenders } from "../src/disputes.ts";
import { ValidatorKey } from "../src/state.ts";
import { vectorFiles, vectorJson } from "./vectors.ts";
import type { Outcome } from "../src/disputes.ts";
import { toHex } from "../src/bytes.ts";
import type { Bytes } from "../src/bytes.ts";

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
  pre_state: { psi: unknown; tau: number; kappa: unknown[]; lambda: unknown[] };
  post_state: { psi: unknown };
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