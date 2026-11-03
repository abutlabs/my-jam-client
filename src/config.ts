// JAM's two configurations, with the same rules: full, the future network with the Gray
// Paper's own numbers, and tiny, small enough to run on one machine. The official test vectors come
// in both, in folders named after them.

/** The protocol constants that depend on the size of the network. */
export type Config = {
  name: string;
  validators_count: number; // V: validators in a set
  core_count: number; // C: cores doing work in parallel
  epoch_length: number; // E: timeslots in an epoch
  epoch_tail_start: number; // Y: the slot of an epoch at which the ticket lottery closes
  rotation_period: number; // R: slots between reshuffles of the guarantors
  expunge_period: number; // D: slots before a forgotten preimage may go
  max_tickets_per_extrinsic: number; // K: tickets a block may carry
  max_lookup_anchor_age: number; // L: how old a lookup anchor may be, in slots
  max_refine_gas: bigint; // G_R: gas for refining a work-package
  max_block_gas: bigint; // G_T: gas for all of a block's accumulation
};

export const TINY: Config = {
  name: "tiny",
  validators_count: 6,
  core_count: 2,
  epoch_length: 12,
  epoch_tail_start: 10,
  rotation_period: 4,
  expunge_period: 32,
  max_tickets_per_extrinsic: 3,
  max_lookup_anchor_age: 24,
  max_refine_gas: 1_000_000_000n,
  max_block_gas: 20_000_000n,
};

export const FULL: Config = {
  name: "full",
  validators_count: 1023,
  core_count: 341,
  epoch_length: 600,
  epoch_tail_start: 500,
  rotation_period: 10,
  expunge_period: 19_200,
  max_tickets_per_extrinsic: 16,
  max_lookup_anchor_age: 14_400,
  max_refine_gas: 5_000_000_000n,
  max_block_gas: 3_500_000_000n,
};
