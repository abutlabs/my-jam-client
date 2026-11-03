// Authorization (GP §8): which authorizers each core will accept work for. Each core keeps
// a small pool of them, refilled one at a time from a long queue.

import type { ReportGuarantee } from "./block.ts";
import type { Bytes } from "./bytes.ts";
import { toHex } from "./bytes.ts";
import type { Value } from "./codec/codec.ts";
import { hash, record, seq, seqN, u16 } from "./codec/codec.ts";
import type { Config } from "./config.ts";

/** O: the most authorizers a core's pool holds. */
export const POOL_SIZE = 8;

/** Q: the length of each core's queue. */
export const QUEUE_SIZE = 80;

/** α, C(1): each core's pool of authorizers, up to O of them. */
export function AuthPools(config: Config) {
  return seqN(seq(hash), config.core_count);
}

/** ϕ, C(2): each core's queue of authorizers, exactly Q of them. */
export function AuthQueues(config: Config) {
  return seqN(seqN(hash, QUEUE_SIZE), config.core_count);
}

/** An authorizer a guarantee used on a core: its report's core and authorizer hash. */
export const UsedAuthorizer = record({
  core: u16,
  auth_hash: hash,
});
export type UsedAuthorizer = Value<typeof UsedAuthorizer>;

/**
 * α′ (GP §8): a core's used authorizer leaves its pool (its oldest copy), the queue's entry
 * for this slot joins, and the pool keeps its newest O.
 */
export function nextPools(
  pools: Bytes[][],
  queues: Bytes[][], // ϕ′
  used: UsedAuthorizer[],
  slot: number, // τ′
): Bytes[][] {
  return pools.map((pool, core) => {
    const left = [...pool];
    for (const { auth_hash } of used.filter((u) => u.core === core)) {
      const oldest = left.findIndex((a) => toHex(a) === toHex(auth_hash));
      if (oldest >= 0) left.splice(oldest, 1);
    }
    const next = queues[core][slot % QUEUE_SIZE]; // the queue goes round, a slot at a time
    return [...left, next].slice(-POOL_SIZE);
  });
}

/** The authorizers a block's guarantees used: one per guaranteed core. */
export function usedAuthorizers(guarantees: ReportGuarantee[]): UsedAuthorizer[] {
  return guarantees.map(({ report }) => ({
    core: report.core_index,
    auth_hash: report.authorizer_hash,
  }));
}
