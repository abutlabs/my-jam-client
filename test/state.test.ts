import { test } from "node:test";
import assert from "node:assert/strict";
import { toHex } from "../src/bytes.ts";
import { blake2b256 } from "../src/hash.ts";
import { accountKey, componentKey, preimageKey, requestKey, readEntropy, readTime, readValidators } from "../src/state.ts";
import { traceState } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";
import { Block, assuranceSigned } from "../src/block.ts";
import { TINY } from "../src/config.ts";
import type { EpochMark } from "../src/block.ts";

test("C(i): a component's key is its number, then 30 zero bytes", () => {
  const key: string = toHex(componentKey(11));
  assert.equal(key, "0x0b" + "00".repeat(30));
});

test("C(255, s): an account's key spreads the service id out, with zeros between", () => {
  const key: string = toHex(accountKey(0x04030201));
  assert.equal(key, "0xff0100020003000400" + "00".repeat(22));
});

test("every key of a real state, named: 16 components, an account, preimages, requests", () => {
  const { entries } = traceState("fallback", 1);
  const keys: string[] = entries.map((e) => toHex(e.key));
  const named: Bytes[] = [accountKey(0)];
  for (let i = 1; i <= 16; i++) named.push(componentKey(i));
  for (const { value } of entries) {
    const key: Bytes = preimageKey(0, value);
    if (!keys.includes(toHex(key))) continue; // not a preimage of service 0
    named.push(key, requestKey(0, blake2b256(value), value.length)); // and its request
  }
  const namedHex: string[] = named.map(toHex).sort();
  const keysHex: string[] = keys.sort();
  assert.deepEqual(namedHex, keysHex);
});

test("τ: the time before each block is the slot of the block before it", () => {
  for (let n = 2; n <= 100; n++) {
    const before: Block = Block(TINY).fromJson(traceState("fallback", n - 1).block);
    const time: number = readTime(traceState("fallback", n).entries);
    assert.equal(time, before.header.slot);
  }
});

test("η: each epoch mark carries η₀ and η₁ from the state before its block", () => {
  let marks = 0;
  for (let n = 1; n <= 100; n++) {
    const { entries, block } = traceState("safrole", n);
    const mark: EpochMark | null = Block(TINY).fromJson(block).header.epoch_mark;
    if (mark === null) continue;
    const entropy: Bytes[] = readEntropy(entries);
    const marked: Bytes[] = [mark.entropy, mark.tickets_entropy];
    const fromState: Bytes[] = [entropy[0], entropy[1]];
    assert.deepEqual(marked, fromState);
    marks++;
  }
  assert.ok(marks > 0);
});

test("κ: real assurances check out with the validators' keys from the state", () => {
  let checked = 0;
  for (let n = 1; n <= 100; n++) {
    const { entries, block } = traceState("preimages", n);
    const keys: Bytes[] = readValidators(entries).map((v) => v.ed25519);
    for (const assurance of Block(TINY).fromJson(block).extrinsic.assurances) {
      const signed: boolean = assuranceSigned(keys, assurance);
      assert.ok(signed, `block ${n}`);
      checked++;
    }
  }
  assert.equal(checked, 524);
});
