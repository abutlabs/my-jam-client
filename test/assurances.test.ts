import { test } from "node:test";
import assert from "node:assert/strict";
import { assuredCount, bitAt, nowAvailable, availableCores, clearCores, assuranceError } from "../src/assurances.ts";
import { Assurance } from "../src/block.ts";
import { fromHex } from "../src/bytes.ts";
import type { Config } from "../src/config.ts";
import { FULL, TINY } from "../src/config.ts";
import { PendingReports } from "../src/cores.ts";
import { WorkReport } from "../src/work.ts";
import { vectorFiles, vectorJson } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";
import type { PendingReport } from "../src/cores.ts";

test("bits are packed least significant first: 0x05 is cores 0 and 2", () => {
  const bitfield: Bytes = fromHex("0x05"); // 0000 0101
  const bits: boolean[] = [0, 1, 2, 3].map((c) => bitAt(bitfield, c));
  assert.deepEqual(bits, [true, false, true, false]);
  const core8: boolean = bitAt(fromHex("0x0001"), 8); // core 8: the lowest bit of byte 1
  assert.equal(core8, true);
});

/** An assurances test vector: the parts of it this lesson uses. */
type AssurancesVector = {
  input: { assurances: unknown[]; slot: number; parent: string };
  pre_state: {
    avail_assignments: unknown;
    curr_validators: { ed25519: string }[];
    post_validators: unknown[];
  };
  post_state: { avail_assignments: unknown };
  output: { err?: string; ok?: { reported: unknown[] } };
};

/** The accepted assurances vectors of a size: a rejected block changes nothing. */
function acceptedVectors(config: Config): { name: string; vector: AssurancesVector }[] {
  return vectorFiles(`stf/assurances/${config.name}`)
    .map((name) => ({ name, vector: vectorJson(name) as AssurancesVector }))
    .filter(({ vector }) => !vector.output.err);
}

test("𝐑: a report becomes available when more than two thirds of κ hold its data", () => {
  let available = 0;
  for (const config of [TINY, FULL]) {
    for (const { name, vector } of acceptedVectors(config)) {
      const { input, pre_state, output } = vector;
      const cores = PendingReports(config).fromJson(pre_state.avail_assignments);
      const assurances = input.assurances.map((a) => Assurance(config).fromJson(a));
      const validators: number = pre_state.curr_validators.length;
      const reports: WorkReport[] = nowAvailable(cores, assurances, validators);
      const expected: WorkReport[] = (output.ok?.reported ?? []).map((r) => WorkReport.fromJson(r));
      assert.deepEqual(reports, expected, name);
      available += reports.length;
    }
  }
  assert.equal(available, 53); // 4 on tiny, 49 on full
});

test("on tiny, 5 of 6 validators make a report available, and 4 don't", () => {
  // 3 × 5 = 15 > 12 = 2 × 6, but 3 × 4 = 12 is not
  const vector = vectorJson("stf/assurances/tiny/some_assurances-1.json") as AssurancesVector;
  const assurances = vector.input.assurances.map((a) => Assurance(TINY).fromJson(a));
  const counts: number[] = [0, 1].map((core) => assuredCount(assurances, core));
  assert.deepEqual(counts, [5, 4]);
});

test("ρ‡: a core lets go of a report once available, timed out, or the set resizes", () => {
  let released = 0;
  for (const config of [TINY, FULL]) {
    for (const { name, vector } of acceptedVectors(config)) {
      const { input, pre_state, post_state } = vector;
      const cores = PendingReports(config).fromJson(pre_state.avail_assignments);
      const assurances = input.assurances.map((a) => Assurance(config).fromJson(a));
      const validators: number = pre_state.curr_validators.length;
      const available: number[] = availableCores(cores, assurances, validators);
      const resized: boolean = validators !== pre_state.post_validators.length;
      const after: (PendingReport | null)[] = clearCores(cores, available, input.slot, resized);
      const expected = PendingReports(config).fromJson(post_state.avail_assignments);
      assert.deepEqual(after, expected, name);
      released += cores.filter((p) => p !== null).length - after.filter((p) => p !== null).length;
    }
  }
  assert.equal(released, 87); // 6 on tiny, 81 on full
});

test("a report registered at slot 7 may wait through slot 11, and times out at 12", () => {
  const vector = vectorJson("stf/assurances/tiny/no_assurances-1.json") as AssurancesVector;
  const cores = PendingReports(TINY).fromJson(vector.pre_state.avail_assignments);
  const pending: PendingReport = { ...(cores[0] as PendingReport), registered_slot: 7 };
  const atEleven: (PendingReport | null)[] = clearCores([pending], [], 11, false);
  assert.deepEqual(atEleven, [pending]);
  const atTwelve: (PendingReport | null)[] = clearCores([pending], [], 12, false);
  assert.deepEqual(atTwelve, [null]); // 12 ≥ 7 + 5
});

/** What the rules say of assurances vector `name`: null (accepted) or the rule broken. */
function verdict(config: Config, name: string) {
  const { input, pre_state } = vectorJson(name) as AssurancesVector;
  const assurances = input.assurances.map((a) => Assurance(config).fromJson(a));
  const keys = pre_state.curr_validators.map((k) => fromHex(k.ed25519)); // κ
  const cores = PendingReports(config).fromJson(pre_state.avail_assignments); // ρ†
  return assuranceError(assurances, fromHex(input.parent), keys, cores);
}

test("an assurance for a core with nothing on it is refused", () => {
  const name = "stf/assurances/tiny/assurance_for_not_engaged_core-1.json";
  const broken: string | null = verdict(TINY, name);
  assert.equal(broken, "core_not_engaged");
});

for (const config of [TINY, FULL]) {
  for (const name of vectorFiles(`stf/assurances/${config.name}`)) {
    test(`${name}: accepted or refused, as the vector says`, () => {
      const { output } = vectorJson(name) as AssurancesVector;
      const broken: string | null = verdict(config, name);
      const expected: string | null = output.err ?? null;
      assert.equal(broken, expected);
    });
  }
}
