// Blocks: a header, and the extrinsic, the data a block brings in from outside (GP §5).

import type { Value } from "./codec/codec.ts";

import { blob, fixedBytes, record, seq, u32, u8, hash, u16, bool, option, seqN, encode } from "./codec/codec.ts";
import type { Config } from "./config.ts";
import { WorkReport } from "./work.ts";
import type { Bytes } from "./bytes.ts";
import { blake2b256 } from "./hash.ts";
import { concatBytes } from "./bytes.ts";
import { verifyEd25519 } from "./signature.ts";

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

/** A guarantor's signature: which validator, and its Ed25519 signature. */
export const ValidatorSignature = record({
  validator_index: u16,
  signature: fixedBytes(64),
});
export type ValidatorSignature = Value<typeof ValidatorSignature>;

/** A guarantee (GP §11): a work-report, vouched for by two or three validators. */
export const ReportGuarantee = record({
  report: WorkReport,
  slot: u32, // when the guarantors signed it
  signatures: seq(ValidatorSignature),
});
export type ReportGuarantee = Value<typeof ReportGuarantee>;

/** The guarantees in a block: at most one per core. */
export const GuaranteesExtrinsic = seq(ReportGuarantee);

/** A judgement (GP §10): one validator's vote on whether a work-report is valid. */
export const Judgement = record({
  vote: bool, // true: valid
  index: u16, // which validator voted
  signature: fixedBytes(64),
});
export type Judgement = Value<typeof Judgement>;

/** A verdict: the votes of two thirds of the validators, plus one, on one report. */
export const Verdict = record({
  target: hash, // the work-report's hash
  age: u32, // the epoch whose validators voted: this one or the one before
  votes: seq(Judgement),
});
export type Verdict = Value<typeof Verdict>;

/** A culprit: a guarantor who vouched for a report that turned out bad. */
export const Culprit = record({
  target: hash,
  key: fixedBytes(32), // the guarantor's Ed25519 key
  signature: fixedBytes(64), // its guarantee, as evidence
});
export type Culprit = Value<typeof Culprit>;

/** A fault: a validator who voted against the verdict. */
export const Fault = record({
  target: hash,
  vote: bool,
  key: fixedBytes(32),
  signature: fixedBytes(64),
});
export type Fault = Value<typeof Fault>;

/** The disputes in a block (GP §10). */
export const DisputesExtrinsic = record({
  verdicts: seq(Verdict),
  culprits: seq(Culprit),
  faults: seq(Fault),
});
export type DisputesExtrinsic = Value<typeof DisputesExtrinsic>;

/** A validator's two public keys, as an epoch mark lists them. */
export const EpochMarkValidatorKeys = record({
  bandersnatch: fixedBytes(32), // for sealing blocks and the ticket lottery
  ed25519: fixedBytes(32), // for signing everything else
});
export type EpochMarkValidatorKeys = Value<typeof EpochMarkValidatorKeys>;

/** The epoch mark (GP §5): at an epoch's first block, the randomness and validators ahead. */
export const EpochMark = record({
  entropy: hash,
  tickets_entropy: hash,
  validators: seq(EpochMarkValidatorKeys),
});
export type EpochMark = Value<typeof EpochMark>;

/** A winning ticket: its id and attempt. Once a ticket has won, its proof can stay behind. */
export const TicketBody = record({
  id: hash,
  attempt: u8,
});
export type TicketBody = Value<typeof TicketBody>;

/** A block header (GP §5). */
export function Header(config: Config) {
  return record({
    parent: hash, // the parent block's header hash
    parent_state_root: hash, // the state root after the parent block
    extrinsic_hash: hash, // commits to this block's extrinsic
    slot: u32,
    epoch_mark: option(EpochMark), // only in an epoch's first block
    tickets_mark: option(seqN(TicketBody, config.epoch_length)), // when the lottery closes
    author_index: u16, // which validator made this block
    entropy_source: fixedBytes(96), // a VRF signature: fresh randomness for the chain
    offenders_mark: seq(fixedBytes(32)), // Ed25519 keys of newly convicted validators
    seal: fixedBytes(96), // the author's signature over everything above
  });
}
export type Header = Value<ReturnType<typeof Header>>;


/** A block's extrinsic (GP §4): the five parts, in Appendix C's order. */
export function Extrinsic(config: Config) {
  return record({
    tickets: TicketsExtrinsic,
    preimages: PreimagesExtrinsic,
    guarantees: GuaranteesExtrinsic,
    assurances: AssurancesExtrinsic(config),
    disputes: DisputesExtrinsic,
  });
}
export type Extrinsic = Value<ReturnType<typeof Extrinsic>>;

/** A block (GP §4): a header and an extrinsic. */
export function Block(config: Config) {
  return record({
    header: Header(config),
    extrinsic: Extrinsic(config),
  });
}
export type Block = Value<ReturnType<typeof Block>>;


/** A header's hash (GP §5): what the next block names as its parent. */
export function headerHash(config: Config, header: Header): Bytes {
  return blake2b256(encode(Header(config), header));
}

/** A preimage as the extrinsic hash sees it: its requester, and the hash of its data. */
const HashedPreimage = record({
  requester: u32,
  hash: hash,
});

/** A guarantee as the extrinsic hash sees it: the report's hash in place of the report. */
const HashedGuarantee = record({
  report: hash,
  slot: u32,
  signatures: seq(ValidatorSignature),
});

/**
 * The extrinsic hash (GP §5): the hash of the five parts' hashes. Preimages and reports
 * go in by their own hashes, so that each can be proven part of the block on its own.
 */
export function extrinsicHash(config: Config, extrinsic: Extrinsic): Bytes {
  const preimages = extrinsic.preimages.map((p) => ({
    requester: p.requester,
    hash: blake2b256(p.blob),
  }));
  const guarantees = extrinsic.guarantees.map((g) => ({
    report: blake2b256(encode(WorkReport, g.report)),
    slot: g.slot,
    signatures: g.signatures,
  }));
  const parts = [
    encode(TicketsExtrinsic, extrinsic.tickets),
    encode(seq(HashedPreimage), preimages),
    encode(seq(HashedGuarantee), guarantees),
    encode(AssurancesExtrinsic(config), extrinsic.assurances),
    encode(DisputesExtrinsic, extrinsic.disputes),
  ];
  return blake2b256(concatBytes(...parts.map(blake2b256)));
}

/** X_A (GP §11): an assurance's message starts with these bytes, "$jam_available" in the GP. */
const AVAILABLE = new TextEncoder().encode("jam_available");

/** What an assurance's validator signs (GP §11): X_A, then the hash of anchor and bitfield. */
export function assuranceMessage(assurance: Assurance): Bytes {
  return concatBytes(AVAILABLE, blake2b256(concatBytes(assurance.anchor, assurance.bitfield)));
}

/** Is an assurance signed by the validator it names? `keys`: the validators' Ed25519 keys. */
export function assuranceSigned(keys: Bytes[], assurance: Assurance): boolean {
  const key = keys[assurance.validator_index];
  return verifyEd25519(key, assuranceMessage(assurance), assurance.signature);
}