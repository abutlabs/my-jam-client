import { test } from "node:test";
import assert from "node:assert/strict";
import { Block, Preimage } from "../src/block.ts";
import { toHex, fromHex } from "../src/bytes.ts";
import { encode } from "../src/codec/codec.ts";
import { TINY } from "../src/config.ts";
import { blake2b256 } from "../src/hash.ts";
import { providePreimages, RequestHistory, footprint, minimumBalance, readService, ServiceInfo, serviceCode } from "../src/services.ts";
import { preimageKey, requestKey } from "../src/state.ts";
import type { KeyValue } from "../src/trie.ts";
import { accountEntries, traceState, vectorFiles, vectorJson } from "./vectors.ts";
import type { PreimagesAccount } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";

test("a request's history: [] waiting, [x] provided at slot x", () => {
  const waiting: string = toHex(encode(RequestHistory, []));
  assert.equal(waiting, "0x00");
  const provided: string = toHex(encode(RequestHistory, [5]));
  assert.equal(provided, "0x0105000000");
});

/** The value under a key in a state's entries, as hex, or undefined. */
function valueAt(entries: KeyValue[], key: Uint8Array): string | undefined {
  const entry = entries.find((e) => toHex(e.key) === toHex(key));
  return entry && toHex(entry.value);
}

test("67 real preimages: stored, and their requests marked with the block's slot", () => {
  let provided = 0;
  for (let n = 1; n < 100; n++) {
    const { entries, block } = traceState("preimages", n);
    const { header, extrinsic } = Block(TINY).fromJson(block);
    if (extrinsic.preimages.length === 0) continue;
    const after: KeyValue[] = providePreimages(entries, extrinsic.preimages, header.slot);
    const expected: KeyValue[] = traceState("preimages", n + 1).entries; // after block n
    for (const { requester, blob } of extrinsic.preimages) {
      const request: Bytes = requestKey(requester, blake2b256(blob), blob.length);
      const requestAfter: string | undefined = valueAt(after, request);
      const requestExpected: string | undefined = valueAt(expected, request);
      assert.equal(requestAfter, requestExpected, `block ${n}`);
      const stored: Bytes = preimageKey(requester, blob);
      const storedAfter: string | undefined = valueAt(after, stored);
      const storedExpected: string | undefined = valueAt(expected, stored);
      assert.equal(storedAfter, storedExpected, `block ${n}`);
      provided++;
    }
  }
  assert.equal(provided, 67); // blocks 1 to 99: each needs the next block's state to compare
});

test("the preimages vectors, as state entries", () => {
  let accepted = 0;
  for (const size of ["tiny", "full"]) {
    for (const name of vectorFiles(`stf/preimages/${size}`)) {
      const { input, pre_state, post_state, output } = vectorJson(name) as {
        input: { preimages: unknown[]; slot: number };
        pre_state: { accounts: PreimagesAccount[] };
        post_state: { accounts: PreimagesAccount[] };
        output: { err?: string };
      };
      if (output.err) continue; // a rejected block changes nothing
      const preimages: Preimage[] = input.preimages.map((p) => Preimage.fromJson(p));
      const before: KeyValue[] = accountEntries(pre_state.accounts);
      const after: KeyValue[] = providePreimages(before, preimages, input.slot);
      const sorted: KeyValue[] = after.sort((a, b) => toHex(a.key).localeCompare(toHex(b.key)));
      const expected: KeyValue[] = accountEntries(post_state.accounts);
      assert.deepEqual(sorted, expected, name);
      accepted++;
    }
  }
  assert.equal(accepted, 6); // 3 at each size
});

test("service 0 in real state: its code beside it, and its footprint adding up", () => {
  const { entries } = traceState("fallback", 1);
  const service: ServiceInfo = readService(entries, 0);
  const codeLength: number | undefined = serviceCode(entries, 0)?.length;
  assert.equal(codeLength, 159322); // its code: lesson 6.1's giant
  const isPreimage = (e: KeyValue) => toHex(e.key) === toHex(preimageKey(0, e.value));
  const preimages: KeyValue[] = entries.filter(isPreimage);
  const requests = preimages.map((p) => ({ length: p.value.length })); // all provided
  const used = footprint([], requests);
  assert.deepEqual(used, { items: service.items, bytes: service.bytes });
});

/** An account in the accumulate vectors: its record, its storage, its requests. */
type VectorAccount = {
  data: {
    service: unknown;
    storage: { key: string; value: string }[];
    preimage_requests: { key: { length: number } }[];
  };
};

test("footprints and minimum balances: 510 accounts in the accumulate vectors", () => {
  let accounts = 0;
  for (const size of ["tiny", "full"]) {
    for (const name of vectorFiles(`stf/accumulate/${size}`)) {
      const { pre_state, post_state } = vectorJson(name) as {
        pre_state: { accounts: VectorAccount[] };
        post_state: { accounts: VectorAccount[] };
      };
      for (const { data } of [...pre_state.accounts, ...post_state.accounts]) {
        const info: ServiceInfo = ServiceInfo.fromJson(data.service);
        const storage: KeyValue[] = data.storage.map((e) => ({
          key: fromHex(e.key),
          value: fromHex(e.value),
        }));
        const requests = data.preimage_requests.map((r) => r.key);
        const used = footprint(storage, requests);
        assert.deepEqual(used, { items: info.items, bytes: info.bytes });
        const minimum: bigint = minimumBalance(info);
        assert.ok(info.balance >= minimum, name);
        accounts++;
      }
    }
  }
  assert.equal(accounts, 510);
});
