import { test } from "node:test";
import assert from "node:assert/strict";
import type { Step, Refused } from "../src/import.ts";
import { STEPS, waves, importBlock } from "../src/import.ts";
import { Block } from "../src/block.ts";
import type { Header } from "../src/block.ts";
import { TINY } from "../src/config.ts";
import type { KeyValue } from "../src/trie.ts";
import { importTrace } from "./families.ts";
import { traceState } from "./vectors.ts";

/** The values each wave makes, wave by wave. */
const made = (ws: Step[][]) => ws.map((w) => w.flatMap((s) => s.makes));

test("the Gray Paper's list isn't a recipe: γ′ comes before η′, which it's made from", () => {
  const at = (x: string) => STEPS.findIndex((s) => s.makes.includes(x));
  const gammaAt: number = at("γ′");
  const etaAt: number = at("η′");
  assert.ok(gammaAt < etaAt);
  const madeFromEta: boolean = STEPS[gammaAt].from.includes("η′");
  assert.ok(madeFromEta);
});

test("four waves: the first needs only the block and the state before it", () => {
  const ws: string[][] = made(waves(STEPS));
  assert.equal(ws.length, 4);
  assert.deepEqual(ws[0], ["τ′", "β_H†", "η′", "κ′", "λ′", "ψ′", "ρ†"]);
  const safroleWaits: boolean = ws[1].includes("γ′"); // for the new entropy, keys and offenders
  assert.ok(safroleWaits);
  assert.deepEqual(ws[3], ["β_H′", "δ′", "α′", "π′"]); // all waiting for accumulation
});

test("every step comes after everything it's made from", () => {
  const ws: Step[][] = waves(STEPS);
  const madeBy = new Map(ws.flatMap((w, i) => w.flatMap((s) => s.makes.map((x) => [x, i]))));
  ws.forEach((wave, i) => {
    for (const step of wave) {
      for (const x of step.from) {
        const madeIn: number = madeBy.get(x) ?? -1;
        assert.ok(madeIn < i, x);
      }
    }
  });
});

test("steps that wait for each other are caught", () => {
  const loop = [
    { makes: ["a′"], from: ["b′"], lesson: "" },
    { makes: ["b′"], from: ["a′"], lesson: "" },
  ];
  assert.throws(() => waves(loop), /wait for each other/);
});

test("Υ on every block of the fallback and safrole traces: each state root, as the trace's", () => {
  for (const family of ["fallback", "safrole"]) {
    for (let n = 1; n <= 100; n++) {
      const { root, expected } = importTrace(family, n);
      assert.equal(root, expected, `${family} block ${n}`);
    }
  }
});

test("a block that isn't the next one is refused, and the state stays as it was", () => {
  const { entries, block } = traceState("fallback", 10);
  const next: Block = Block(TINY).fromJson(block);
  const stale: Header = { ...next.header, parent: new Uint8Array(32) }; // not block 9
  const result: KeyValue[] | Refused = importBlock(TINY, entries, { ...next, header: stale });
  assert.deepEqual(result, { error: "bad_parent" });
});

test("Υ with work: the first 25 blocks of the storage_light and preimages_light traces", () => {
  for (const family of ["storage_light", "preimages_light"]) {
    for (let n = 1; n <= 25; n++) {
      const { root, expected } = importTrace(family, n);
      assert.equal(root, expected, `${family} block ${n}`);
    }
  }
});

test("blocks the fuzzy trace refuses, and the ones around them", () => {
  const refused: string[] = [];
  for (let n = 30; n <= 41; n++) {
    const { root, expected, after } = importTrace("fuzzy", n);
    if ("error" in after) refused.push(`${n}: ${after.error}`);
    else assert.equal(root, expected, `fuzzy block ${n}`);
  }
  assert.deepEqual(refused, ["37: bad_code_hash", "38: bad_code_hash", "39: bad_code_hash"]);
});

test("Υ on the first 25 blocks of the fuzzy_light trace", () => {
  for (let n = 1; n <= 25; n++) {
    const { root, expected } = importTrace("fuzzy_light", n);
    assert.equal(root, expected, `fuzzy_light block ${n}`);
  }
});
