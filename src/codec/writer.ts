// Writer: collects the parts of an encoding, then glues them together.

import type { Bytes } from "../bytes.ts";
import { concatBytes } from "../bytes.ts";
import { encodeFixed, encodeNatural } from "./numbers.ts";

export class Writer {
  #parts: Bytes[] = [];

  /** Bytes as they are: in the GP a blob encodes to itself. */
  bytes(b: Bytes): void {
    this.#parts.push(b);
  }

  /** ℰ_l(x) */
  fixed(x: bigint, l: number): void {
    this.bytes(encodeFixed(x, l));
  }

  /** ℰ(x) */
  natural(x: bigint): void {
    this.bytes(encodeNatural(x));
  }

  /** Everything written so far, as one byte string. */
  finish(): Bytes {
    return concatBytes(...this.#parts);
  }
}
