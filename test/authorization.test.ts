import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPools } from "../src/authorization.ts";
import { traceState, vectorFiles } from "./vectors.ts";
import { Block } from "../src/block.ts";
import { usedAuthorizers } from "../src/authorization.ts";
import { readAuthPools, readAuthQueues } from "../src/state.ts";
import { checkAuthorizations } from "./families.ts";
import { TINY } from "../src/config.ts";
import type { UsedAuthorizer } from "../src/authorization.ts";
import type { Bytes } from "../src/bytes.ts";

/** An authorizer hash made of one repeated byte, so the test reads like letters. */
const auth = (byte: number) => new Uint8Array(32).fill(byte);
const [A, B, C] = [auth(0xaa), auth(0xbb), auth(0xcc)];

test("the used authorizer leaves, the queue's next one joins", () => {
  const queue: Bytes[] = Array.from({ length: 80 }, (_, i) => (i === 3 ? C : A)); // C waits at 3
  const afterUse: Bytes[][] = nextPools([[A, B]], [queue], [{ core: 0, auth_hash: B }], 3);
  assert.deepEqual(afterUse, [[A, C]]);
  const nextRound: Bytes[][] = nextPools([[A, B]], [queue], [], 83); // 83 mod 80 = 3
  assert.deepEqual(nextRound, [[A, B, C]]);
});

test("a full pool keeps its newest eight", () => {
  const full: Bytes[] = [A, A, A, A, A, A, A, B]; // eight already
  const queue: Bytes[] = Array.from({ length: 80 }, () => C);
  const after: Bytes[][] = nextPools([full], [queue], [], 0);
  assert.deepEqual(after, [[A, A, A, A, A, A, B, C]]);
});

test("α′ on the authorizations vectors", () => {
  const names: string[] = [
    ...vectorFiles("stf/authorizations/tiny"),
    ...vectorFiles("stf/authorizations/full"),
  ];
  for (const name of names) checkAuthorizations(name);
  assert.equal(names.length, 6);
});

test("α′ through 99 real blocks, with the authorizers their own guarantees used", () => {
  let used = 0;
  for (let n = 1; n < 100; n++) {
    const before = traceState("preimages", n);
    const after = traceState("preimages", n + 1); // the state after block n
    const block: Block = Block(TINY).fromJson(before.block);
    const auths: UsedAuthorizer[] = usedAuthorizers(block.extrinsic.guarantees);
    const pools: Bytes[][] = readAuthPools(TINY, before.entries);
    const queues: Bytes[][] = readAuthQueues(TINY, after.entries); // ϕ′: after the block
    const next: Bytes[][] = nextPools(pools, queues, auths, block.header.slot);
    const expected: Bytes[][] = readAuthPools(TINY, after.entries);
    assert.deepEqual(next, expected, `block ${n}`);
    used += auths.length;
  }
  assert.equal(used, 85);
});
