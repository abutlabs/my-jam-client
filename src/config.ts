// Two sizes of JAM: the real network ("full"), and a tiny one that tests run fast on.
// The official test vectors come in both, in folders named after them.

/** The protocol constants that depend on the size of the network. */
export type Config = {
  name: string;
  validators_count: number; // V: validators in a set
  core_count: number; // C: cores doing work in parallel
  epoch_length: number; // E: timeslots in an epoch
};

export const TINY: Config = { name: "tiny", validators_count: 6, core_count: 2, epoch_length: 12 };

export const FULL: Config = { name: "full", validators_count: 1023, core_count: 341, epoch_length: 600 };