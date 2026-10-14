// The official test vectors, in vectors/ at the repo root (npm run vectors there).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Bytes } from "../src/bytes.ts";
import type { Codec } from "../src/codec/codec.ts";
import { decode, encode } from "../src/codec/codec.ts";

/** The official test vectors' folder: vectors/, at the repo root. */
export const VECTORS = fileURLToPath(new URL("../../vectors/", import.meta.url));

/** A vector file's JSON, by its name in vectors/, such as "codec/tiny/work_item.json". */
export function vectorJson(name: string): unknown {
  return JSON.parse(readFileSync(VECTORS + name, "utf8"));
}

/** A vector file's bytes. */
export function vectorBytes(name: string): Bytes {
  return new Uint8Array(readFileSync(VECTORS + name));
}

/** A codec vector: the .bin decodes to the .json's value, which encodes back to the .bin. */
export function checkCodecVector<T>(codec: Codec<T>, name: string): void {
  const bytes: Bytes = vectorBytes(`${name}.bin`);
  const expected: T = codec.fromJson(vectorJson(`${name}.json`));
  const decoded: T = decode(codec, bytes);
  assert.deepEqual(decoded, expected);
  const encoded: Bytes = encode(codec, expected);
  assert.deepEqual(encoded, bytes);
}