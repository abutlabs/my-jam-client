// Codec<T>: one kind of value, how it is encoded (GP Appendix C), how it is decoded,
// and how the test vectors write it in JSON.

import type { Bytes } from "../bytes.ts";
import { Reader } from "./reader.ts";
import { Writer } from "./writer.ts";
import { fromHex } from "../bytes.ts";
import type { Trace } from "./reader.ts";

/** 𝔹_n: exactly n bytes, encoded as themselves. */
export function fixedBytes(n: number): Codec<Bytes> {
  return {
    encode: (w, b) => w.bytes(b),
    decode: (r) => r.bytes(n),
    fromJson: (json) => fromHex(json as string),
  };
}

/** ℍ: a 32-byte hash. */
export const hash = fixedBytes(32);

/** ↕x: a blob of any length, its length first. */
export const blob: Codec<Bytes> = {
  encode: (w, b) => {
    w.natural(BigInt(b.length));
    w.bytes(b);
  },
  decode: (r) => r.bytes(Number(r.natural())),
  fromJson: (json) => fromHex(json as string),
};

export interface Codec<T> {
  encode(w: Writer, value: T): void;
  decode(r: Reader): T;
  /** The value, from the way the test vectors write it in JSON. */
  fromJson(json: unknown): T;
}

/** The type of value a codec handles: Value<typeof u32> is number. */
export type Value<C> = C extends Codec<infer T> ? T : never;

/** ℰ(value): the value's encoding. */
export function encode<T>(codec: Codec<T>, value: T): Bytes {
  const w = new Writer();
  codec.encode(w, value);
  return w.finish();
}

/** The value these bytes encode. A trace gets every field. */
export function decode<T>(codec: Codec<T>, bytes: Bytes, trace: Trace | null = null): T {
  return codec.decode(new Reader(bytes, trace));
}

/** ℰ_l for l = 1, 2 or 4, as a JS number. */
function fixedNumber(l: number): Codec<number> {
  return {
    encode: (w, x) => w.fixed(BigInt(x), l),
    decode: (r) => Number(r.fixed(l)),
    fromJson: (json) => json as number,
  };
}

/** ℰ₁: a u8. */
export const u8 = fixedNumber(1);

/** ℰ₂: a u16. */
export const u16 = fixedNumber(2);

/** ℰ₄: a u32: timeslots, service ids. */
export const u32 = fixedNumber(4);

/** ℰ₈: a u64: gas, balances. */
export const u64: Codec<bigint> = {
  encode: (w, x) => w.fixed(x, 8),
  decode: (r) => r.fixed(8),
  fromJson: (json) => BigInt(json as number),
};

/** ℰ, compact: a natural below 2^64. */
export const natural: Codec<bigint> = {
  encode: (w, x) => w.natural(x),
  decode: (r) => r.natural(),
  fromJson: (json) => BigInt(json as number),
};

/** ℰ, compact, for small counts and lengths, as a JS number. */
export const natural32: Codec<number> = {
  encode: (w, x) => w.natural(BigInt(x)),
  decode: (r) => Number(r.natural()),
  fromJson: (json) => json as number,
};

/** ↕[...]: a sequence of any length, its length first. */
export function seq<T>(item: Codec<T>): Codec<T[]> {
  return {
    encode: (w, items) => {
      w.natural(BigInt(items.length));
      for (const x of items) item.encode(w, x);
    },
    decode: (r) => {
      const n = r.field("length", () => Number(r.natural()));
      return Array.from({ length: n }, (_, i) => r.field(String(i), () => item.decode(r)));
    },
    fromJson: (json) => (json as unknown[]).map((j) => item.fromJson(j)),
  };
}

// Codec<any>: a record's fields hold codecs of different types.
type Fields = Record<string, Codec<any>>;

/** A tuple with named fields, encoded field after field in the order they are written. */
export function record<F extends Fields>(fields: F): Codec<{ [K in keyof F]: Value<F[K]> }> {
  type T = { [K in keyof F]: Value<F[K]> };
  const names = Object.keys(fields) as (keyof F & string)[];
  return {
    encode: (w, value) => {
      for (const name of names) fields[name].encode(w, value[name]);
    },
    decode: (r) => {
      const value: Partial<T> = {};
      for (const name of names) value[name] = r.field(name, () => fields[name].decode(r));
      return value as T;
    },
    fromJson: (json) => {
      const object = json as Record<string, unknown>;
      const value: Partial<T> = {};
      for (const name of names) value[name] = fields[name].fromJson(object[name]);
      return value as T;
    },
  };
}