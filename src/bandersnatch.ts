// Bandersnatch (GP App. G): the elliptic curve JAM's VRF signatures are made on. A VRF
// signature starts with its output point, and hashing that point gives the output, 𝒴.

import type { Bytes } from "./bytes.ts";
import { concatBytes } from "./bytes.ts";
import { sha512 } from "@noble/hashes/sha2.js";

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