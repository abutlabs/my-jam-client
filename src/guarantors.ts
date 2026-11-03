// Guarantor assignments (GP §11): which validators may guarantee work for which core.
// Three per core, dealt out by a shuffle, and moved on to the next core every R slots.

import type { Bytes } from "./bytes.ts";
import type { Config } from "./config.ts";
import { epochOf } from "./epoch.ts";
import { withoutOffenders } from "./safrole.ts";
import { shuffleWithHash } from "./shuffle.ts";
import type { ValidatorKey } from "./state.ts";
import { fromHex, toHex } from "./bytes.ts";
import type { ReportGuarantee } from "./block.ts";
import { encode } from "./codec/codec.ts";
import { guaranteeMessage } from "./disputes.ts";
import { blake2b256 } from "./hash.ts";
import { verifyEd25519 } from "./signature.ts";
import { WorkReport } from "./work.ts";
import type { PendingReport } from "./cores.ts";
import type { WorkDigest } from "./work.ts";
import type { RecentBlock } from "./history.ts";

/** P (GP §11): the core each of v validators guarantees at a slot, dealt with entropy e. */
export function assignCores(config: Config, v: number, e: Bytes, slot: number): number[] {
  const seats = Array.from({ length: v }, (_, i) => Math.floor(i / 3)); // 0 0 0 1 1 1 2 …
  const shuffled = shuffleWithHash(seats, e);
  const turns = Math.floor((slot % config.epoch_length) / config.rotation_period);
  const activeCores = v / 3;
  return shuffled.map((core) => (core + turns) % activeCores); // R: everyone moves on
}

/** An assignment (GP's M): each validator's core, and the validators' keys (offenders out). */
export type Assignment = { cores: number[]; keys: ValidatorKey[] };

/** M and M*: the guarantors of this rotation, and of the one before it. */
export function guarantorAssignments(
  config: Config,
  slot: number, // τ′
  entropy: Bytes[], // η′
  active: ValidatorKey[], // κ′
  previous: ValidatorKey[], // λ′
  offenders: Bytes[], // ψ′_O
): { current: Assignment; last: Assignment } {
  const assignment = (keys: ValidatorKey[], e: Bytes, at: number): Assignment => ({
    cores: assignCores(config, keys.length, e, at),
    keys: withoutOffenders(keys, offenders),
  });
  const then = slot - config.rotation_period; // a slot in the last rotation
  const sameEpoch = epochOf(config, then) === epochOf(config, slot);
  return {
    current: assignment(active, entropy[2], slot),
    last: sameEpoch ? assignment(active, entropy[2], then) : assignment(previous, entropy[3], then),
  };
}

/** Which assignment a guarantee made at `made` answers to, in a block at `slot`. */
export function assignmentFor(
  config: Config,
  slot: number,
  made: number,
  assignments: { current: Assignment; last: Assignment },
): Assignment {
  const R = config.rotation_period;
  return Math.floor(slot / R) === Math.floor(made / R) ? assignments.current : assignments.last;
}

/** The Ed25519 keys of a guarantee's signers, from the assignment's keys. */
export function signerKeys(guarantee: ReportGuarantee, keys: ValidatorKey[]): Bytes[] {
  return guarantee.signatures.map((s) => keys[s.validator_index].ed25519);
}

/** Whether every signature on a guarantee is its guarantor's, over the report's hash. */
export function guaranteeSigned(guarantee: ReportGuarantee, keys: ValidatorKey[]): boolean {
  const message = guaranteeMessage(blake2b256(encode(WorkReport, guarantee.report)));
  const signers = signerKeys(guarantee, keys);
  return guarantee.signatures.every((s, i) => verifyEd25519(signers[i], message, s.signature));
}

/** 𝐆, the reporters (GP §11): every guarantor who signed in the block, once each, sorted. */
export function reporters(signers: Bytes[]): Bytes[] {
  return [...new Set(signers.map(toHex))].sort().map(fromHex);
}

/** An offender's key, as Φ leaves it in an assignment: blanked to zeros (lesson 8.2). */
const BLANK = toHex(new Uint8Array(32));

/**
 * Are a block's guarantees valid (GP §11)? The first rule they break, under the test
 * vectors' name for it, or null if they keep every rule. `assignments` is M and M*,
 * `cores` is ρ‡ and `pools` is α, both by core, and `validators` is |κ′|.
 */
export function guaranteeError(
  config: Config,
  guarantees: ReportGuarantee[],
  slot: number, // τ′
  assignments: { current: Assignment; last: Assignment },
  cores: (PendingReport | null)[],
  pools: Bytes[][],
  validators: number,
): string | null {
  type G = ReportGuarantee;
  const R = config.rotation_period;
  const core = (g: G) => g.report.core_index;
  const assigned = (g: G) => assignmentFor(config, slot, g.slot, assignments); // M or M*
  // the guarantee's shape
  const inOrder = guarantees.every((g, i) => i === 0 || core(guarantees[i - 1]) < core(g));
  const activeCore = (g: G) => core(g) < config.core_count && core(g) < validators / 3;
  const twoOrThree = (g: G) => g.signatures.length === 2 || g.signatures.length === 3;
  const signersInOrder = (g: G) => {
    const indices = g.signatures.map((s) => s.validator_index);
    return indices.every((v, i) => i === 0 || indices[i - 1] < v);
  };
  // who signed it, and when
  const knownSigners = (g: G) =>
    g.signatures.every((s) => s.validator_index < assigned(g).keys.length);
  const notFuture = (g: G) => g.slot <= slot;
  const recent = (g: G) => g.slot >= R * (Math.floor(slot / R) - 1); // this rotation or the last
  const notBanned = (g: G) => signerKeys(g, assigned(g).keys).every((k) => toHex(k) !== BLANK);
  const onItsCore = (g: G) =>
    g.signatures.every((s) => assigned(g).cores[s.validator_index] === core(g));
  const signed = (g: G) => guaranteeSigned(g, assigned(g).keys);
  // the core it goes on
  const shards = (g: G) => g.report.package_spec.erasure_shards === validators;
  const free = (g: G) => cores[core(g)] === null;
  const authorized = (g: G) =>
    pools[core(g)].some((h) => toHex(h) === toHex(g.report.authorizer_hash));
  if (!inOrder) return "out_of_order_guarantee";
  if (!guarantees.every(activeCore)) return "bad_core_index";
  if (!guarantees.every(twoOrThree)) return "insufficient_guarantees";
  if (!guarantees.every(signersInOrder)) return "not_sorted_or_unique_guarantors";
  if (!guarantees.every(knownSigners)) return "bad_validator_index";
  if (!guarantees.every(notFuture)) return "future_report_slot";
  if (!guarantees.every(recent)) return "report_epoch_before_last";
  if (!guarantees.every(notBanned)) return "banned_validator";
  if (!guarantees.every(onItsCore)) return "wrong_assignment";
  if (!guarantees.every(signed)) return "bad_signature";
  if (!guarantees.every(shards)) return "bad_erasure_shards";
  if (!guarantees.every(free)) return "core_engaged";
  if (!guarantees.every(authorized)) return "core_unauthorized";
  return null;
}

/** I: the most work items (so digests) a report may carry. */
const MAX_DIGESTS = 16;
/** J: the most dependencies (prerequisites and segment-root lookups) a report may have. */
const MAX_DEPENDENCIES = 8;
/** W_R: the most bytes a report's outputs (its digests' and its authorizer's) may take. */
const MAX_OUTPUT = 48 * 1024;
/** G_A: the most accumulation gas a report may ask for, all its digests together. */
export const REPORT_GAS = 10_000_000n;

/** What a report needs of a service: its code hash, and the least gas it accumulates on. */
export type ServiceNeeds = { code_hash: Bytes; min_item_gas: bigint };

/**
 * Are a block's reports valid (GP §11)? The first rule they break, under the test vectors'
 * name for it, or null if they keep every rule. `history` is the recent blocks (β_H†),
 * `known` the packages already in the pipeline (accumulated, waiting, or on a core: the
 * vectors' `known_packages`), and `services` what each service needs, by id.
 */
export function reportError(
  reports: WorkReport[], // 𝐈
  history: RecentBlock[],
  known: Set<string>,
  services: Map<number, ServiceNeeds>,
): string | null {
  const incoming = new Map(reports.map((r) => [toHex(r.package_spec.hash), r])); // 𝐩
  const reported = new Map(history.flatMap((b) => b.reported.map((p) => [toHex(p.hash), p])));
  const rootOf = (hash: Bytes) =>
    incoming.get(toHex(hash))?.package_spec.exports_root ?? reported.get(toHex(hash))?.exports_root;
  const anchor = (r: WorkReport) =>
    history.find((b) => toHex(b.header_hash) === toHex(r.context.anchor));
  const digests = reports.flatMap((r) => r.results);
  const outputOf = (d: WorkDigest) => ("ok" in d.result ? d.result.ok.length : 0);
  const output = (r: WorkReport) =>
    r.auth_output.length + r.results.reduce((n, d) => n + outputOf(d), 0);
  // the report on its own
  const someWork = (r: WorkReport) => r.results.length >= 1 && r.results.length <= MAX_DIGESTS;
  const fewDependencies = (r: WorkReport) =>
    r.context.prerequisites.length + r.segment_root_lookup.length <= MAX_DEPENDENCIES;
  const gas = (r: WorkReport) => r.results.reduce((n, d) => n + d.accumulate_gas, 0n);
  // the report against the chain
  const fresh = (hash: string) => !reported.has(hash) && !known.has(hash);
  const anchored = (r: WorkReport) => anchor(r) !== undefined;
  const sameRoot = (r: WorkReport) => toHex(anchor(r)!.state_root) === toHex(r.context.state_root);
  const sameBelt = (r: WorkReport) => toHex(anchor(r)!.beefy_root) === toHex(r.context.beefy_root);
  const sameSlot = (r: WorkReport) => anchor(r)!.slot === r.context.anchor_slot;
  const prerequisitesKnown = (r: WorkReport) =>
    r.context.prerequisites.every((p) => rootOf(p) !== undefined);
  const lookupsRight = (r: WorkReport) =>
    r.segment_root_lookup.every((l) => {
      const root = rootOf(l.work_package_hash);
      return root !== undefined && toHex(root) === toHex(l.segment_tree_root);
    });
  if (!reports.every(someWork)) return "missing_work_results";
  if (!reports.every(fewDependencies)) return "too_many_dependencies";
  if (!reports.every((r) => output(r) <= MAX_OUTPUT)) return "work_report_too_big";
  if (!reports.every((r) => gas(r) <= REPORT_GAS)) return "work_report_gas_too_high";
  if (incoming.size < reports.length || ![...incoming.keys()].every(fresh)) {
    return "duplicate_package";
  }
  if (!reports.every(anchored)) return "anchor_not_recent";
  if (!reports.every(sameRoot)) return "bad_state_root";
  if (!reports.every(sameBelt)) return "bad_beefy_mmr_root";
  if (!reports.every(sameSlot)) return "bad_anchor_slot";
  if (!reports.every(prerequisitesKnown)) return "dependency_missing";
  if (!reports.every(lookupsRight)) return "segment_root_lookup_invalid";
  if (!digests.every((d) => services.has(d.service_id))) return "bad_service_id";
  const service = (d: WorkDigest) => services.get(d.service_id)!;
  if (!digests.every((d) => toHex(service(d).code_hash) === toHex(d.code_hash))) {
    return "bad_code_hash";
  }
  if (!digests.every((d) => d.accumulate_gas >= service(d).min_item_gas)) {
    return "service_item_gas_too_low";
  }
  return null;
}
