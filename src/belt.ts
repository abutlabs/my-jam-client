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