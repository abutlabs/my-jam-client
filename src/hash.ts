// Hashing (GP §3): Blake2b-256, the hash JAM uses almost everywhere.

import type { Bytes } from "./bytes.ts";
import { blake2b } from "@noble/hashes/blake2.js";

/** H(x): Blake2b with a 32-byte output. */
export function blake2b256(data: Bytes): Bytes {
  //return blake2b(data);
  return blake2b(data, { dkLen: 32 });
}
