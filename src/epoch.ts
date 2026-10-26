// Epochs (GP §6): the chain's hours. A slot belongs to an epoch, and a few things change
// only when a new epoch begins.

import type { Bytes } from "./bytes.ts";
import type { Config } from "./config.ts";

/** e: the epoch a slot falls in, ⌊slot / E⌋. */
export function epochOf(config: Config, slot: number): number {
  return Math.floor(slot / config.epoch_length);
}

/** m: where a slot falls within its epoch, slot mod E, from 0 to E − 1. */
export function phaseOf(config: Config, slot: number): number {
  return slot % config.epoch_length;
}

/** η′₁, η′₂, η′₃: at a new epoch, the entropy history moves along one; otherwise it stays. */
export function entropyHistory(entropy: Bytes[], newEpoch: boolean): Bytes[] {
  return newEpoch ? entropy.slice(0, 3) : entropy.slice(1, 4);
}