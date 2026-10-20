// Signatures (GP §3): Ed25519, as RFC 8032 defines it. Validators sign most of what they
// say with it; blocks and tickets use Bandersnatch instead.

import type { Bytes } from "./bytes.ts";
import { ed25519 } from "@noble/curves/ed25519.js";

/** Is `signature` a valid Ed25519 signature of `message`, by the holder of `key`? */
export function verifyEd25519(key: Bytes, message: Bytes, signature: Bytes): boolean {
  return ed25519.verify(signature, message, key);
}