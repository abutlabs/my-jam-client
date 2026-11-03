// The accumulation output belt (GP §7, App. E): a Merkle mountain belt. A compact
// commitment to every block's accumulation outputs, built with Keccak so that other chains
// can check it.

import type { Bytes } from "./bytes.ts";
import { concatBytes } from "./bytes.ts";
import { keccak256 } from "./hash.ts";

/** A mountain belt: peak i is the root of 2^i items, or null if there's no such mountain. */
export type Belt = (Bytes | null)[];

/** A (GP App. E): append an item, merging equal mountains as it goes, like adding 1 in binary. */
export function appendToBelt(belt: Belt, item: Bytes): Belt {
  const peaks = [...belt];
  let carry = item;
  for (let i = 0; i < peaks.length; i++) {
    const peak = peaks[i];
    if (peak === null) {
      peaks[i] = carry; // an empty place: the mountain rests here
      return peaks;
    }
    carry = keccak256(concatBytes(peak, carry)); // two mountains of 2^i make one of 2^(i+1)
    peaks[i] = null;
  }
  peaks.push(carry); // a new, biggest mountain
  return peaks;
}

/** "$peak" in the Gray Paper: the $ marks an ASCII string, as in lesson 5.3. */
const PEAK = new TextEncoder().encode("peak");

/** M_R (GP App. E): the super-peak, one hash for the whole belt. */
export function superPeak(belt: Belt): Bytes {
  const peaks = belt.filter((peak) => peak !== null);
  if (peaks.length === 0) return new Uint8Array(32);
  if (peaks.length === 1) return peaks[0];
  const last = peaks[peaks.length - 1];
  return keccak256(concatBytes(PEAK, superPeak(peaks.slice(0, -1)), last));
}

/** "$node" in the Gray Paper: the prefix of a Merkle tree's inner nodes. */
const NODE = new TextEncoder().encode("node");

/**
 * N (GP App. E): the node over `items`: none, the zero hash; one, the item itself; more,
 * the hash of "node" and the nodes over the first half (rounded up) and the rest.
 */
function node(items: Bytes[]): Bytes {
  if (items.length === 0) return new Uint8Array(32);
  if (items.length === 1) return items[0];
  const half = Math.ceil(items.length / 2);
  return keccak256(concatBytes(NODE, node(items.slice(0, half)), node(items.slice(half))));
}

/** M_B (GP App. E): the well-balanced Merkle root of `items`, with Keccak. A single item is
 * hashed, so the root is always a hash; more items are joined by N. */
export function wellBalancedRoot(items: Bytes[]): Bytes {
  return items.length === 1 ? keccak256(items[0]) : node(items);
}
