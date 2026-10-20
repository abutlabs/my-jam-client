import { test } from "node:test";
import assert from "node:assert/strict";
import { Block, headerHash, extrinsicHash } from "../src/block.ts";
import { toHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import { blake2b256 } from "../src/hash.ts";
import { vectorJson } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";

test("Blake2b-256 of nothing at all", () => {
  const empty: string = "0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8";
  const hashed: string = toHex(blake2b256(new Uint8Array(0)));
  assert.equal(hashed, empty);
});

/** Block n of a tiny trace ("fallback" unless said): a chain of 100 real blocks. */
function traceBlock(n: number, family = "fallback"): Block {
  const name = `traces/${family}/${String(n).padStart(8, "0")}.json`;
  const trace = vectorJson(name) as { block: unknown };
  return Block(TINY).fromJson(trace.block);
}

test("each block names its parent by the hash of the header before it", () => {
  for (let n = 2; n <= 100; n++) {
    const parent: Bytes = traceBlock(n).header.parent;
    const previousHeaderHash: Bytes = headerHash(TINY, traceBlock(n - 1).header);
    assert.deepEqual(parent, previousHeaderHash);
  }
});

test("every block's header promises its extrinsic by hash", () => {
  for (const family of ["fallback", "safrole", "preimages", "storage"]) {
    for (let n = 1; n <= 100; n++) {
      const { header, extrinsic }: Block = traceBlock(n, family);
      const hashed: Bytes = extrinsicHash(TINY, extrinsic);
      assert.deepEqual(hashed, header.extrinsic_hash, `${family} ${n}`);
    }
  }
});