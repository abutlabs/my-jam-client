// The shuffle (GP App. F): a Fisher-Yates shuffle that every node can repeat, because the
// randomness it uses comes from a hash they all share.

import type { Bytes } from "./bytes.ts";
import { concatBytes } from "./bytes.ts";
import type { Trace } from "./codec/reader.ts";
import { decodeFixed, encodeFixed } from "./codec/numbers.ts";
import { blake2b256 } from "./hash.ts";

/** F(s, r): pick item r₀ mod l, put the last item in its place, and go again with r₁... */
export function shuffle<T>(items: T[], numbers: number[], trace?: Trace): T[] {
  const left = [...items]; // what's still to be picked
  const out: T[] = [];
  for (const number of numbers.slice(0, items.length)) {
    const index = number % left.length;
    const picked = left[index];
    trace?.event("pick", { number, left: left.length, index, picked });
    out.push(picked);
    left[index] = left[left.length - 1]; // the last item fills the gap
    left.pop();
  }
  return out;
}

/** Q_l(h): l numbers from a hash. Each Blake2b of h and a counter gives eight of them. */
export function numbersFromHash(h: Bytes, l: number): number[] {
  const numbers: number[] = [];
  for (let i = 0; i < l; i++) {
    const block = blake2b256(concatBytes(h, encodeFixed(BigInt(Math.floor(i / 8)), 4)));
    const at = (4 * i) % 32; // number i is bytes 4i to 4i + 4 of its block, wrapping at 32
    numbers.push(Number(decodeFixed(block.subarray(at, at + 4))));
  }
  return numbers;
}

/** F(s, h): the shuffle as JAM uses it, with its numbers drawn from a hash. */
export function shuffleWithHash<T>(items: T[], h: Bytes, trace?: Trace): T[] {
  return shuffle(items, numbersFromHash(h, items.length), trace);
}
