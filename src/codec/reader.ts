// Reader: walks through the bytes of an encoding, front to back.

import type { Bytes } from "../bytes.ts";
import { decodeFixed, decodeNatural } from "./numbers.ts";

export class Reader {
  #bytes: Bytes;
  #at = 0; // where the next read starts
  #trace: Trace | null;
  #path: string[] = []; // the names of the fields being read, outermost first
  #inner = false; // whether the field being read has named fields of its own

  constructor(bytes: Bytes, trace: Trace | null = null) {
    this.#bytes = bytes;
    this.#trace = trace;
  }

  
  /** The next n bytes. */
  bytes(n: number): Bytes {
    const out = this.#bytes.slice(this.#at, this.#at + n);
    this.#at += n;
    return out;
  }

  /** The inverse of ℰ_l. */
  fixed(l: number): bigint {
    return decodeFixed(this.bytes(l));
  }

  /** The inverse of ℰ. */
  natural(): bigint {
    const { value, length } = decodeNatural(this.#bytes, this.#at);
    this.#at += length;
    return value;
  }

  /**
   * Reads one named part of a value. With a trace, every innermost part is reported: its
   * path (import_segments.0.index), where its bytes start and end, and the bytes.
   */
  field<T>(name: string, read: () => T): T {
    const from = this.#at;
    this.#path.push(name);
    this.#inner = false;
    const value = read();
    if (this.#trace && !this.#inner) {
      const bytes = this.#bytes.subarray(from, this.#at);
      this.#trace.event("decode", { field: this.#path.join("."), from, to: this.#at, bytes });
    }
    this.#path.pop();
    this.#inner = true; // tell the enclosing field it had a named field inside
    return value;
  }
}

/** What a Reader can report to: anything with an event method, such as a Run (src/obs.ts). */
export interface Trace {
  event(step: string, fields: Record<string, unknown>): void;
}
