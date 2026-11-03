import { test } from "node:test";
import assert from "node:assert/strict";
import { toHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import type { State } from "../src/whole-state.ts";
import { readState, writeState } from "../src/whole-state.ts";
import type { KeyValue } from "../src/trie.ts";
import { readService, serviceCode, preimageOf, setStorageValue, storageValue } from "../src/services.ts";
import type { ServiceInfo, Account } from "../src/services.ts";
import { traceState } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";
import { storageKey } from "../src/state.ts";

/** The eight block-import trace families. */
export const FAMILIES = [
  "fallback", "safrole", "storage", "storage_light",
  "preimages", "preimages_light", "fuzzy", "fuzzy_light",
];

/** A state's entries as hex, key → value: two states are the same if these are. */
const asHex = (entries: KeyValue[]) =>
  new Map(entries.map((e) => [toHex(e.key), toHex(e.value)]));

test("states of all eight traces, read whole and written back, byte for byte", () => {
  let states = 0;
  for (const family of FAMILIES) {
    for (let n = 1; n <= 100; n += 11) {
      const { entries } = traceState(family, n);
      const state: State = readState(TINY, entries);
      const written: KeyValue[] = writeState(TINY, state);
      assert.deepEqual(asHex(written), asHex(entries), `${family} block ${n}`);
      states++;
    }
  }
  assert.equal(states, 80);
});

test("each account: its record, and every entry it keeps, by its state key", () => {
  const { entries } = traceState("storage", 50);
  const { accounts } = readState(TINY, entries);
  const info: ServiceInfo = accounts.get(0)!.info;
  assert.deepEqual(info, readService(entries, 0));
  const items: number = [...accounts.values()].reduce((n, a) => n + a.items!.size, 0);
  const components = 16;
  assert.equal(components + accounts.size + items, entries.length); // nothing left over
});

test("an account read from the state: the helpers find its code and keep its storage", () => {
  const { entries } = traceState("storage", 50);
  const account: Account = readState(TINY, entries).accounts.get(0)!;
  const code: Bytes | undefined = preimageOf(account, 0, toHex(account.info.code_hash));
  assert.deepEqual(code, serviceCode(entries, 0)); // found by its state key
  const key: Bytes = new TextEncoder().encode("hello");
  setStorageValue(account, 0, key, Uint8Array.of(1, 2, 3));
  const value: Bytes | undefined = storageValue(account, 0, key);
  assert.deepEqual(value, Uint8Array.of(1, 2, 3));
  const kept: boolean = account.items!.has(toHex(storageKey(0, key))); // C(0, ℰ₄(2^32 − 1) ⌢ k)
  assert.ok(kept);
});
