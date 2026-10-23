// State keys (GP App. D): where in the state trie each part of the state lives.

import type { Bytes } from "./bytes.ts";
import { concatBytes, toHex } from "./bytes.ts";
import { encodeFixed } from "./codec/numbers.ts";
import { blake2b256 } from "./hash.ts";
import type { Codec, Value } from "./codec/codec.ts";
import { decode, fixedBytes, hash, record, seq, seqN, u32 } from "./codec/codec.ts";
import type { KeyValue } from "./trie.ts";

/** C(i): the key of state component i. The byte i, then 30 zeros. */
export function componentKey(i: number): Bytes {
  const key = new Uint8Array(31);
  key[0] = i;
  return key;
}

/** C(255, s): the key of service s's account. 255, then ℰ₄(s) with a zero after each byte. */
export function accountKey(s: number): Bytes {
  const n = encodeFixed(BigInt(s), 4);
  const key = new Uint8Array(31);
  key[0] = 255;
  for (let i = 0; i < 4; i++) key[1 + 2 * i] = n[i];
  return key;
}

/** C(s, h): the key of something service s keeps. ℰ₄(s) woven into the hash of h. */
export function serviceItemKey(s: number, h: Bytes): Bytes {
  const n = encodeFixed(BigInt(s), 4);
  const a = blake2b256(h);
  const key = new Uint8Array(31);
  for (let i = 0; i < 4; i++) {
    key[2 * i] = n[i]; // the service's bytes at 0, 2, 4, 6
    key[2 * i + 1] = a[i]; // the hash's first four at 1, 3, 5, 7
  }
  key.set(a.subarray(4, 27), 8); // and 23 more of the hash after them
  return key;
}

/** Where service s keeps the preimage p: C(s, ℰ₄(2^32 − 2) ⌢ H(p)). */
export function preimageKey(s: number, p: Bytes): Bytes {
  return serviceItemKey(s, concatBytes(encodeFixed(2n ** 32n - 2n, 4), blake2b256(p)));
}

/** Where service s records its request for the preimage of hash h, l bytes long. */
export function requestKey(s: number, h: Bytes, l: number): Bytes {
  return serviceItemKey(s, concatBytes(encodeFixed(BigInt(l), 4), h));
}

/** A validator's keys (GP §6): 336 bytes, the four keys it uses for different jobs. */
export const ValidatorKey = record({
  bandersnatch: fixedBytes(32), // for sealing blocks and the ticket lottery
  ed25519: fixedBytes(32), // for signing everything else
  bls: fixedBytes(144), // for BEEFY, which bridges to other chains
  metadata: fixedBytes(128), // where to reach it on the network
});
export type ValidatorKey = Value<typeof ValidatorKey>;

/** State component i, read from the state's entries with its codec. */
function component<T>(entries: KeyValue[], i: number, codec: Codec<T>): T {
  const key = toHex(componentKey(i));
  const entry = entries.find((e) => toHex(e.key) === key);
  if (!entry) throw new Error(`the state has no component ${i}`);
  return decode(codec, entry.value);
}

/** τ, C(11): the time, as the slot of the most recent block. */
export function readTime(entries: KeyValue[]): number {
  return component(entries, 11, u32);
}

/** η, C(6): four 32-byte hashes of fresh randomness, the newest first. */
export function readEntropy(entries: KeyValue[]): Bytes[] {
  return component(entries, 6, seqN(hash, 4));
}

/** κ, C(8): the validators of this epoch. */
export function readValidators(entries: KeyValue[]): ValidatorKey[] {
  return component(entries, 8, seq(ValidatorKey));
}