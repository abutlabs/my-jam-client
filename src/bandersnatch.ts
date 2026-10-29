// Bandersnatch (GP App. G): the elliptic curve JAM's VRF signatures are made on. A VRF
// signature starts with its output point, and hashing that point gives the output, 𝒴.

import type { Bytes } from "./bytes.ts";
import { concatBytes } from "./bytes.ts";
import { sha512 } from "@noble/hashes/sha2.js";
import { bandersnatch } from "@typeberry/native";

/** The VRF suite's name, which the VRF library JAM uses (ark-vrf) hashes in everywhere. */
const SUITE = new TextEncoder().encode("Bandersnatch_SHA-512_ELL2");

/**
 * 𝒴 (GP App. G): a VRF signature's output, 32 bytes its signer couldn't choose. The first
 * 32 bytes of the signature are a point on the curve; the output is SHA-512 of the suite's
 * name, a 3, that point and a 0, cut to 32 bytes. Reading it doesn't check the signature.
 */
export function vrfOutput(signature: Bytes): Bytes {
  const point = signature.subarray(0, 32);
  return sha512(concatBytes(SUITE, Uint8Array.of(3), point, Uint8Array.of(0))).subarray(0, 32);
}

/** The Bandersnatch library, started once: it loads native or WebAssembly code first. */
const library = await bandersnatch.default();

/**
 * 𝒪 (GP App. G): the ring root of some Bandersnatch keys, the 144 bytes ring proofs are
 * checked against. The ring has a fixed size, the chain's validator count: missing keys,
 * and keys that aren't points on the curve (such as an offender's zeros), are padding.
 */
export function ringRoot(keys: Bytes[], size: number): Bytes {
  const padding = Array.from({ length: size - keys.length }, () => new Uint8Array(32));
  const result = library.ringCommitment(concatBytes(...keys, ...padding));
  if (result[0] !== 0) throw new Error("the Bandersnatch library made no ring root");
  return Uint8Array.from(result.subarray(1)); // a plain copy: the library may hand back a Buffer
}

/** A ring proof (784 bytes) and the input it claims to be made for. */
export type RingProof = { proof: Bytes; input: Bytes };

/**
 * Whether every ring proof checks out against the ring root, a ring of `size` keys: made
 * by one of the ring's keys, for its input. All or nothing: the library checks them in
 * one batch, so it can't say which proof failed.
 */
export function ringProofsHold(root: Bytes, size: number, proofs: RingProof[]): boolean {
  if (proofs.length === 0) return true;
  const data = concatBytes(...proofs.flatMap((p) => [p.proof, p.input]));
  return library.batchVerifyTickets(size, root, data, proofs[0].input.length)[0] === 0;
}