// Statistics (GP §13): who did what. The chain keeps a tally of each validator's work, for
// this epoch and the last, so that whoever pays validators knows who earned it.

import type { Extrinsic, Assurance, Preimage } from "./block.ts";
import { toHex } from "./bytes.ts";
import type { Value } from "./codec/codec.ts";
import { record, u32, natural, natural32 } from "./codec/codec.ts";
import type { Config } from "./config.ts";
import { reporters, signerKeys } from "./guarantors.ts";
import type { ValidatorKey } from "./state.ts";
import type { AccumulationStats } from "./accumulate.ts";
import { assuredCount } from "./assurances.ts";
import type { RefineLoad, WorkReport } from "./work.ts";

/** One validator's tally for one epoch (GP §13), under the test vectors' names. */
export const ValidatorStats = record({
  blocks: u32, // b: blocks it made
  tickets: u32, // t: tickets it put in its blocks
  pre_images: u32, // p: preimages it put in its blocks
  pre_images_size: u32, // d: their bytes, all together
  guarantees: u32, // g: reports it guaranteed
  assurances: u32, // a: availability assurances it made
});
export type ValidatorStats = Value<typeof ValidatorStats>;

/** A tally with nothing in it yet. */
const fresh = (): ValidatorStats => ({
  blocks: 0, tickets: 0, pre_images: 0, pre_images_size: 0, guarantees: 0, assurances: 0,
});

/**
 * π_V and π_L, one block on (GP §13). First the block's assurances count, in the epoch they
 * were made in. Then, if the block starts a new epoch, this epoch's tally becomes the last
 * one and a fresh one begins. Then the author gets its block, tickets and preimages, and
 * every validator who signed a guarantee gets one guarantee. `validators` is κ′.
 */
export function updateValidatorStats(
  config: Config,
  before: { slot: number; current: ValidatorStats[]; last: ValidatorStats[] },
  slot: number, // τ′
  author: number, // the header's author index
  extrinsic: Extrinsic,
  validators: ValidatorKey[],
) {
  let current = before.current.map((s) => ({ ...s }));
  let last = before.last;
  for (const a of extrinsic.assurances) current[a.validator_index].assurances += 1;
  const epoch = (t: number) => Math.floor(t / config.epoch_length);
  if (epoch(slot) !== epoch(before.slot)) {
    last = current;
    current = validators.map(fresh);
  }
  const mine = current[author];
  mine.blocks += 1;
  mine.tickets += extrinsic.tickets.length;
  mine.pre_images += extrinsic.preimages.length;
  mine.pre_images_size += extrinsic.preimages.reduce((n, p) => n + p.blob.length, 0);
  const signers = extrinsic.guarantees.flatMap((g) => signerKeys(g, validators));
  const signed = new Set(reporters(signers).map(toHex)); // 𝐆, once each
  validators.forEach((key, v) => {
    if (signed.has(toHex(key.ed25519))) current[v].guarantees += 1;
  });
  return { current, last };
}

/** One core's work in one block (GP §13, π_C), under the test vectors' names. */
export const CoreStats = record({
  da_load: natural32, // D: bytes it must keep available, for reports that became available
  popularity: natural32, // assurances that it holds a report's data
  imports: natural32, // from here down: the work in the reports it took on (R(c))
  extrinsic_count: natural32,
  extrinsic_size: natural32,
  exports: natural32,
  bundle_size: natural32, // L: those reports' bundles, all together
  gas_used: natural,
});
export type CoreStats = Value<typeof CoreStats>;

/** W_G: the size of a segment, an exported piece of data (GP App. I). */
const SEGMENT_SIZE = 4104;

/** What a report's data costs to keep available: its bundle, and its exported segments
 * with one more for every 64 of them (their proofs), rounded up. */
const dataLoad = (spec: { length: number; exports_count: number }) =>
  spec.length + SEGMENT_SIZE * Math.ceil((spec.exports_count * 65) / 64);

/**
 * π_C′ (GP §13): what each core did in this block. Its work: the digests of the reports it
 * took on (I), summed. Its data load: the reports of its that became available (R), each
 * bundle plus its exported segments. Its popularity: how many assurances name it.
 */
export function coreStats(
  config: Config,
  incoming: WorkReport[], // I: the reports guaranteed in this block
  available: WorkReport[], // R: the reports that became available in this block
  assurances: Assurance[],
): CoreStats[] {
  return Array.from({ length: config.core_count }, (_, c) => {
    const mine = incoming.filter((r) => r.core_index === c);
    const loads = mine.flatMap((r) => r.results.map((d) => d.refine_load));
    const sum = (f: (l: RefineLoad) => number) => loads.reduce((n, l) => n + f(l), 0);
    const kept = available.filter((r) => r.core_index === c).map((r) => r.package_spec);
    return {
      da_load: kept.reduce((n, spec) => n + dataLoad(spec), 0),
      popularity: assuredCount(assurances, c),
      imports: sum((l) => l.imports),
      extrinsic_count: sum((l) => l.extrinsic_count),
      extrinsic_size: sum((l) => l.extrinsic_size),
      exports: sum((l) => l.exports),
      bundle_size: mine.reduce((n, r) => n + r.package_spec.length, 0),
      gas_used: loads.reduce((n, l) => n + l.gas_used, 0n),
    };
  });
}

/** One service's activity in one block (GP §13, π_S), under the test vectors' names. */
export const ServiceStats = record({
  provided_count: natural32, // preimages provided for it
  provided_size: natural32, // their bytes
  refinement_count: natural32, // its digests in the reports guaranteed (R(s))
  refinement_gas_used: natural,
  imports: natural32,
  extrinsic_count: natural32,
  extrinsic_size: natural32,
  exports: natural32,
  accumulate_count: natural32, // from here down: lesson 17.1's accumulation statistics
  accumulate_transfer_count: natural32,
  accumulate_gas_used: natural,
});
export type ServiceStats = Value<typeof ServiceStats>;

/**
 * π_S′ (GP §13): every service active in this block, and what it did: preimages provided
 * for it, its share of the guaranteed reports' work, and its accumulation (lesson 17.1).
 */
export function serviceStats(
  incoming: WorkReport[],
  preimages: Preimage[],
  accumulation: Map<number, AccumulationStats>,
): Map<number, ServiceStats> {
  const digests = incoming.flatMap((r) => r.results);
  const active = new Set([
    ...digests.map((d) => d.service_id),
    ...preimages.map((p) => p.requester),
    ...accumulation.keys(),
  ]);
  const stats = new Map<number, ServiceStats>();
  for (const s of active) {
    const mine = digests.filter((d) => d.service_id === s).map((d) => d.refine_load);
    const sum = (f: (l: RefineLoad) => number) => mine.reduce((n, l) => n + f(l), 0);
    const provided = preimages.filter((p) => p.requester === s);
    const acc = accumulation.get(s) ?? { count: 0, transfers: 0, gasUsed: 0n };
    stats.set(s, {
      provided_count: provided.length,
      provided_size: provided.reduce((n, p) => n + p.blob.length, 0),
      refinement_count: mine.length,
      refinement_gas_used: mine.reduce((n, l) => n + l.gas_used, 0n),
      imports: sum((l) => l.imports),
      extrinsic_count: sum((l) => l.extrinsic_count),
      extrinsic_size: sum((l) => l.extrinsic_size),
      exports: sum((l) => l.exports),
      accumulate_count: acc.count,
      accumulate_transfer_count: acc.transfers,
      accumulate_gas_used: acc.gasUsed,
    });
  }
  return stats;
}
