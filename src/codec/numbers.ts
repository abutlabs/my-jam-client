// The Gray Paper's integer encodings (Appendix C).

import type { Bytes } from "../bytes.ts";
import { concatBytes } from "../bytes.ts";


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

/** ℰ(x): x below 2^64 in 1 to 9 bytes; the first byte says how many follow. */
export function encodeNatural(x: bigint): Bytes {
  for (let l = 0; l < 8; l++) {
    if (x < 1n << BigInt(7 * (l + 1))) {
      const top = Number(x >> BigInt(8 * l)); // ⌊x / 2^(8l)⌋
      const rest = x & ((1n << BigInt(8 * l)) - 1n); // x mod 2^(8l)
      return concatBytes(Uint8Array.of(256 - (256 >> l) + top), encodeFixed(rest, l));
    }
  }
  return concatBytes(Uint8Array.of(255), encodeFixed(x, 8));
}

/** The natural encoded at bytes[offset], and how many bytes it took. */
export function decodeNatural(bytes: Bytes, offset = 0): { value: bigint; length: number } {
  const first = bytes[offset];
  let l = 0;
  while (l < 8 && first & (0x80 >> l)) l++; // count the leading one-bits
  const rest = decodeFixed(bytes.subarray(offset + 1, offset + 1 + l));
  if (l === 8) return { value: rest, length: 9 };
  const top = BigInt(first & (0x7f >> l)); // the bits after the l ones and the zero
  return { value: (top << BigInt(8 * l)) | rest, length: l + 1 };
}

