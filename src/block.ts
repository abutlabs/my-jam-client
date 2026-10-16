// Blocks: a header, and the extrinsic, the data a block brings in from outside (GP §5).

import type { Value } from "./codec/codec.ts";
import { blob, fixedBytes, record, seq, u32, u8, hash, u16 } from "./codec/codec.ts";
import type { Config } from "./config.ts";


/** A ticket (GP §6): an anonymous entry in the draw for who authors which slot. */
export const TicketEnvelope = record({
  attempt: u8, // which of its tries the validator used
  signature: fixedBytes(784), // a ring VRF proof: one of the validators made it, but which?
});
export type TicketEnvelope = Value<typeof TicketEnvelope>;

/** The tickets in a block. */
export const TicketsExtrinsic = seq(TicketEnvelope);

/** A preimage (GP §12): data that a service asked for by its hash, delivered. */
export const Preimage = record({
  requester: u32, // the service that asked
  blob: blob,
});
export type Preimage = Value<typeof Preimage>;

/** The preimages in a block. */
export const PreimagesExtrinsic = seq(Preimage);

/** An assurance (GP §11): a validator's promise that it holds its chunks for these cores. */
export function Assurance(config: Config) {
  return record({
    anchor: hash, // the parent block's hash
    bitfield: fixedBytes(Math.ceil(config.core_count / 8)), // one bit per core, lowest first
    validator_index: u16,
    signature: fixedBytes(64), // the validator's Ed25519 signature
  });
}
export type Assurance = Value<ReturnType<typeof Assurance>>;

/** The assurances in a block. */
export function AssurancesExtrinsic(config: Config) {
  return seq(Assurance(config));
}