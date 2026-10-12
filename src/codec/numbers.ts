// The Gray Paper's integer encodings (Appendix C).

import type { Bytes } from "../bytes.ts";

/** ℰ_l(x): x in exactly l bytes, least significant first. */
export function encodeFixed(x: bigint, l: number): Bytes {
  const bytes = new Uint8Array(l);
  let rest = x;
  for (let i = 0; i < l; i++) {
    bytes[i] = Number(rest & 0xffn); // x mod 256
    rest >>= 8n; // ⌊x / 256⌋
  }
  return bytes;
}

/** The inverse of ℰ_l: the bytes as an unsigned little-endian integer. */
export function decodeFixed(bytes: Bytes): bigint {
  let x = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(bytes[i]);
  return x;
}