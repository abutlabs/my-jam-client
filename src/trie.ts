// The state trie (GP App. D): one 32-byte root that commits to every key and value in the
// state. Change any value anywhere, and the root changes.

import type { Bytes } from "./bytes.ts";
import { concatBytes } from "./bytes.ts";
import type { Trace } from "./codec/reader.ts";
import { blake2b256 } from "./hash.ts";

/** One entry of the state: a 31-byte key, and its value. */
export type KeyValue = { key: Bytes; value: Bytes };

/** Bit i of a key, counting from the most significant bit of its first byte. */
function bit(key: Bytes, i: number): number {
  const byte = key[Math.floor(i / 8)];
  return (byte >> (7 - (i % 8))) & 1;
}

/** A leaf node: 64 bytes holding the key, and the value itself if it fits in 32 bytes. */
function leaf(key: Bytes, value: Bytes): Bytes {
  const node = new Uint8Array(64);
  if (value.length <= 32) {
    node[0] = 0b10000000 | value.length; // 1, 0: a leaf with the value inside; its length
    node.set(value, 32);
  } else {
    node[0] = 0b11000000; // 1, 1: a leaf with the value's hash
    node.set(blake2b256(value), 32);
  }
  node.set(key, 1);
  return node;
}

/** A branch node: its two subtries' hashes, side by side, with the first bit cleared. */
function branch(left: Bytes, right: Bytes): Bytes {
  const node = concatBytes(left, right);
  node[0] = node[0] & 0b01111111; // 0: a branch
  return node;
}

/** M (GP App. D): the hash of the trie of these entries, which agree on their first bits. */
function merkle(entries: KeyValue[], depth: number, trace?: Trace): Bytes {
  if (entries.length === 0) return new Uint8Array(32); // an empty trie is 32 zero bytes
  if (entries.length === 1) {
    const { key, value } = entries[0];
    trace?.event("leaf", { depth, key, size: value.length });
    return blake2b256(leaf(key, value));
  }
  const left = entries.filter((e) => bit(e.key, depth) === 0);
  const right = entries.filter((e) => bit(e.key, depth) === 1);
  return blake2b256(branch(merkle(left, depth + 1, trace), merkle(right, depth + 1, trace)));
}

/** The state root: the hash of the trie of every entry in the state. */
export function stateRoot(entries: KeyValue[], trace?: Trace): Bytes {
  return merkle(entries, 0, trace);
}
