import { test } from "node:test";
import assert from "node:assert/strict";
import { GuaranteesExtrinsic } from "../src/block.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import type { Bytes } from "../src/bytes.ts";
import type { Config } from "../src/config.ts";
import { FULL, TINY } from "../src/config.ts";
import { assignCores, assignmentFor, guarantorAssignments, guaranteeSigned, reporters, signerKeys, guaranteeError, reportError } from "../src/guarantors.ts";
import { ValidatorKey } from "../src/state.ts";
import { vectorFiles, vectorJson } from "./vectors.ts";
import { PendingReports, placeReports, reportedPackages } from "../src/cores.ts";
import type { PendingReport } from "../src/cores.ts";
import { RecentBlock } from "../src/history.ts";

test("P: three guarantors per core, and every R slots they all move on one core", () => {
  const e: Bytes = new Uint8Array(32).fill(7); // any entropy will do
  const now: number[] = assignCores(TINY, 6, e, 0);
  const perCore: number[] = [0, 1].map((core) => now.filter((c) => c === core).length);
  assert.deepEqual(perCore, [3, 3]);
  const next: number[] = assignCores(TINY, 6, e, 4); // R = 4 slots later, on tiny
  const movedOn: number[] = now.map((core) => (core + 1) % 2);
  assert.deepEqual(next, movedOn);
});

/** A reports test vector: the parts of it this lesson uses. */
type ReportsVector = {
  input: { guarantees: unknown[]; slot: number; known_packages: string[] };
  pre_state: {
    curr_validators: unknown[];
    prev_validators: unknown[];
    entropy: string[];
    offenders: string[];
    avail_assignments: unknown;
    auth_pools: string[][];
    recent_blocks: { history: unknown[] };
    accounts: { id: number; data: { service: { code_hash: string; min_item_gas: number } } }[];
  };
  post_state: { avail_assignments: unknown };
  output: { err?: string; ok?: { reporters: string[]; reported: unknown[] } };
};

/** For each guarantee in a reports vector: its report's core, and the signers' cores. */
function signerCores(config: Config, vector: ReportsVector) {
  return assigned(config, vector).map(({ guarantee, assignment }) => ({
    core: guarantee.report.core_index,
    signers: guarantee.signatures.map((s) => assignment.cores[s.validator_index]),
  }));
}

test("every guarantor of every accepted report is assigned to that report's core", () => {
  let signatures = 0;
  for (const config of [TINY, FULL]) {
    for (const name of vectorFiles(`stf/reports/${config.name}`)) {
      const vector = vectorJson(name) as ReportsVector;
      if (vector.output.err) continue; // a rejected block changes nothing
      for (const { core, signers } of signerCores(config, vector)) {
        for (const signer of signers) assert.equal(signer, core, name);
        signatures += signers.length;
      }
    }
  }
  assert.equal(signatures, 130); // 62 on tiny, 68 on full
});

test("a guarantor from another core is caught", () => {
  const vector = vectorJson("stf/reports/tiny/wrong_assignment-1.json") as ReportsVector;
  const [{ core, signers }] = signerCores(TINY, vector);
  const elsewhere: boolean = signers.some((signer) => signer !== core);
  assert.ok(elsewhere);
});

/** Each guarantee in a reports vector, with the assignment, M or M*, it answers to. */
function assigned(config: Config, vector: ReportsVector) {
  const { input, pre_state } = vector;
  const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
  const assignments = guarantorAssignments(
    config,
    input.slot,
    pre_state.entropy.map(fromHex),
    keys(pre_state.curr_validators),
    keys(pre_state.prev_validators),
    pre_state.offenders.map(fromHex),
  );
  return GuaranteesExtrinsic.fromJson(input.guarantees).map((guarantee) => ({
    guarantee,
    assignment: assignmentFor(config, input.slot, guarantee.slot, assignments),
  }));
}

test("every accepted guarantee is signed by its guarantors, and 𝐆 lists them once each", () => {
  let checked = 0;
  for (const config of [TINY, FULL]) {
    for (const name of vectorFiles(`stf/reports/${config.name}`)) {
      const vector = vectorJson(name) as ReportsVector;
      if (vector.output.err) continue;
      const signers: Bytes[] = [];
      for (const { guarantee, assignment } of assigned(config, vector)) {
        const signed: boolean = guaranteeSigned(guarantee, assignment.keys);
        assert.ok(signed, name);
        signers.push(...signerKeys(guarantee, assignment.keys));
        checked++;
      }
      const reportersHex: string[] = reporters(signers).map(toHex);
      assert.deepEqual(reportersHex, vector.output.ok?.reporters, name);
    }
  }
  assert.equal(checked, 44); // 21 guarantees on tiny, 23 on full
});

test("a forged guarantee signature is caught", () => {
  const vector = vectorJson("stf/reports/tiny/bad_signature-1.json") as ReportsVector;
  const [{ guarantee, assignment }] = assigned(TINY, vector);
  const signed: boolean = guaranteeSigned(guarantee, assignment.keys);
  assert.equal(signed, false);
});

/** The accepted reports vectors of a size: a rejected block changes nothing. */
function acceptedVectors(config: Config): { name: string; vector: ReportsVector }[] {
  return vectorFiles(`stf/reports/${config.name}`)
    .map((name) => ({ name, vector: vectorJson(name) as ReportsVector }))
    .filter(({ vector }) => !vector.output.err);
}

test("ρ′: each guaranteed report takes its core, registered at the block's slot", () => {
  let placed = 0;
  for (const config of [TINY, FULL]) {
    for (const { name, vector } of acceptedVectors(config)) {
      const { input, pre_state, post_state } = vector;
      const before = PendingReports(config).fromJson(pre_state.avail_assignments);
      const guarantees = GuaranteesExtrinsic.fromJson(input.guarantees);
      const after: (PendingReport | null)[] = placeReports(before, guarantees, input.slot);
      const expected = PendingReports(config).fromJson(post_state.avail_assignments);
      assert.deepEqual(after, expected, name);
      placed += guarantees.length;
    }
  }
  assert.equal(placed, 44); // 21 on tiny, 23 on full
});

test("the reported packages: each one's hash and exports root, sorted by hash", () => {
  for (const config of [TINY, FULL]) {
    for (const { name, vector } of acceptedVectors(config)) {
      const guarantees = GuaranteesExtrinsic.fromJson(vector.input.guarantees);
      const reported = reportedPackages(guarantees).map((p) => ({
        work_package_hash: toHex(p.hash),
        segment_tree_root: toHex(p.exports_root),
      }));
      assert.deepEqual(reported, vector.output.ok?.reported, name);
    }
  }
});

/** The rules lesson 12.4 checks, under the test vectors' names for them. */
const GUARANTEE_RULES = new Set([
  "out_of_order_guarantee", "bad_core_index", "insufficient_guarantees",
  "not_sorted_or_unique_guarantors", "bad_validator_index", "future_report_slot",
  "report_epoch_before_last", "banned_validator", "wrong_assignment", "bad_signature",
  "bad_erasure_shards", "core_engaged", "core_unauthorized",
]);

/** What the guarantee rules say of reports vector `name`: null (they pass) or the rule broken. */
function guaranteeVerdict(config: Config, name: string) {
  const { input, pre_state } = vectorJson(name) as ReportsVector;
  const keys = (list: unknown[]) => list.map((key) => ValidatorKey.fromJson(key));
  const assignments = guarantorAssignments(
    config,
    input.slot,
    pre_state.entropy.map(fromHex),
    keys(pre_state.curr_validators),
    keys(pre_state.prev_validators),
    pre_state.offenders.map(fromHex),
  );
  const guarantees = GuaranteesExtrinsic.fromJson(input.guarantees);
  const cores = PendingReports(config).fromJson(pre_state.avail_assignments); // ρ‡
  const pools = pre_state.auth_pools.map((pool) => pool.map(fromHex)); // α, core by core
  const validators = pre_state.curr_validators.length; // |κ′|
  return guaranteeError(config, guarantees, input.slot, assignments, cores, pools, validators);
}

test("a guarantee signed by an offender is refused", () => {
  const name = "stf/reports/tiny/banned_validator_guarantee-1.json";
  const broken: string | null = guaranteeVerdict(TINY, name);
  assert.equal(broken, "banned_validator");
});

for (const config of [TINY, FULL]) {
  for (const name of vectorFiles(`stf/reports/${config.name}`)) {
    test(`${name}: its guarantees pass, or break the rule the vector names`, () => {
      const { err } = (vectorJson(name) as ReportsVector).output;
      const broken: string | null = guaranteeVerdict(config, name);
      const expected: string | null = err && GUARANTEE_RULES.has(err) ? err : null;
      assert.equal(broken, expected);
    });
  }
}

/** What lesson 12.5's rules say of reports vector `name`: null (they pass) or the rule broken. */
function reportVerdict(name: string) {
  const { input, pre_state } = vectorJson(name) as ReportsVector;
  const reports = GuaranteesExtrinsic.fromJson(input.guarantees).map((g) => g.report);
  const history = pre_state.recent_blocks.history.map((b) => RecentBlock.fromJson(b));
  const services = new Map(pre_state.accounts.map(({ id, data: { service } }) => [id, {
    code_hash: fromHex(service.code_hash),
    min_item_gas: BigInt(service.min_item_gas),
  }]));
  return reportError(reports, history, new Set(input.known_packages), services);
}

test("a report anchored on a block nobody remembers is refused", () => {
  const broken: string | null = reportVerdict("stf/reports/tiny/anchor_not_recent-1.json");
  assert.equal(broken, "anchor_not_recent");
});

for (const config of [TINY, FULL]) {
  for (const name of vectorFiles(`stf/reports/${config.name}`)) {
    test(`${name}: accepted or refused, as the vector says`, () => {
      const { err } = (vectorJson(name) as ReportsVector).output;
      const broken: string | null = guaranteeVerdict(config, name) ?? reportVerdict(name);
      const expected: string | null = err ?? null;
      assert.equal(broken, expected);
    });
  }
}
