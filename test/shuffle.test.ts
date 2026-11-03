import { test } from "node:test";
import assert from "node:assert/strict";
import { shuffle } from "../src/shuffle.ts";
import { checkShuffle } from "./families.ts";

test("a shuffle by hand: four letters, four numbers", () => {
  const shuffled: string[] = shuffle(["a", "b", "c", "d"], [1, 1, 0, 0]);
  assert.deepEqual(shuffled, ["b", "d", "a", "c"]);
});

test("the shuffle vectors: 0 to 341 items, shuffled by a hash", () =>
  checkShuffle("shuffle/shuffle_tests.json"));
