// The official test vectors, in vectors/ at the repo root (npm run vectors there).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Bytes } from "../src/bytes.ts";
import type { Codec } from "../src/codec/codec.ts";
import { decode, encode } from "../src/codec/codec.ts";
import { test } from "node:test";
import type { Config } from "../src/config.ts";
import { FULL, TINY } from "../src/config.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { RequestHistory, serviceCode } from "../src/services.ts";
import { preimageKey, requestKey } from "../src/state.ts";
import type { KeyValue } from "../src/trie.ts";

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

/**
 * Tests a codec against a codec vector at both sizes, tiny and full. A codec whose shape
 * depends on the size comes as a function of the config.
 */
export function testCodecVector(
  name: string,
  codec: Codec<unknown> | ((config: Config) => Codec<unknown>),
): void {
  for (const config of [TINY, FULL]) {
    const sized = typeof codec === "function" ? codec(config) : codec;
    test(`${name} (${config.name})`, () => checkCodecVector(sized, `codec/${config.name}/${name}`));
  }
}

/** The state before block n of a tiny trace, the state root its header promises, the block. */
export function traceState(family: string, n: number) {
  const name = `traces/${family}/${String(n).padStart(8, "0")}.json`;
  const trace = vectorJson(name) as {
    pre_state: { keyvals: { key: string; value: string }[] };
    block: { header: { parent_state_root: string } };
  };
  const entries = trace.pre_state.keyvals.map((e) => ({
    key: fromHex(e.key),
    value: fromHex(e.value),
  }));
  return { entries, promised: trace.block.header.parent_state_root, block: trace.block };
}

/** The JSON vectors in a folder of vectors/, by name, such as "stf/safrole/tiny". */
export function vectorFiles(folder: string): string[] {
  const files = readdirSync(VECTORS + folder).filter((f) => f.endsWith(".json"));
  return files.map((f) => `${folder}/${f}`);
}

/** A preimages vector's account, the way the vector writes it. */
export type PreimagesAccount = {
  id: number;
  data: {
    preimage_blobs: { blob: string }[];
    preimage_requests: { key: { hash: string; length: number }; value: number[] }[];
  };
};

/** Accounts as state entries: every preimage and every request, under its key, sorted. */
export function accountEntries(accounts: PreimagesAccount[]): KeyValue[] {
  const entries = accounts.flatMap(({ id, data }) => [
    ...data.preimage_blobs.map(({ blob }) => ({
      key: preimageKey(id, fromHex(blob)),
      value: fromHex(blob),
    })),
    ...data.preimage_requests.map(({ key, value }) => ({
      key: requestKey(id, fromHex(key.hash), key.length),
      value: encode(RequestHistory, value),
    })),
  ]);
  return entries.sort((a, b) => toHex(a.key).localeCompare(toHex(b.key)));
}

/** The code of service 0, from the state before the first block of the fallback trace. */
export function bootstrapCode(): Uint8Array {
  const { entries } = traceState("fallback", 1);
  return serviceCode(entries, 0)!;
}
