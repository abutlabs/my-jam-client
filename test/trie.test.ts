import { test } from "node:test";
import assert from "node:assert/strict";
import { toHex } from "../src/bytes.ts";
import { stateRoot } from "../src/trie.ts";
import { checkTrie } from "./families.ts";
import { traceState } from "./vectors.ts";

test("the trie vectors: from no entries at all to ten", () => checkTrie("trie/trie.json"));

test("each header promises the state before its block, by its root: 400 real states", () => {
  for (const family of ["fallback", "safrole", "preimages", "storage"]) {
    for (let n = 1; n <= 100; n++) {
      const { entries, promised } = traceState(family, n);
      const root: string = toHex(stateRoot(entries));
      assert.equal(root, promised, `${family} ${n}`);
    }
  }
});
