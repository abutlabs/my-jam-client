import { test } from "node:test";
import assert from "node:assert/strict";
import { vrfOutput } from "../src/bandersnatch.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { nextEntropy } from "../src/safrole.ts";
import { readEntropy, readTime } from "../src/state.ts";
import { Block } from "../src/block.ts";
import type { Header } from "../src/block.ts";
import { TINY } from "../src/config.ts";
import { epochOf } from "../src/epoch.ts";
import { traceState, vectorFiles, vectorJson } from "./vectors.ts";
import type { Bytes } from "../src/bytes.ts";

/** A safrole vector's tickets, and the ids in its lottery after the block. */
type TicketsVector = {
  input: { extrinsic: { attempt: number; signature: string }[] };
  post_state: { gamma_a: { id: string }[] };
  output: { err?: string };
};

test("a ticket's id is its proof's VRF output", () => {
  let checked = 0;
  for (const size of ["tiny", "full"]) {
    for (const name of vectorFiles(`stf/safrole/${size}`)) {
      const vector = vectorJson(name) as TicketsVector;
      if (vector.output.err) continue; // a refused block keeps none of its tickets
      const ids = new Set(vector.post_state.gamma_a.map((t) => t.id));
      for (const ticket of vector.input.extrinsic) {
        const id: string = toHex(vrfOutput(fromHex(ticket.signature)));
        assert.ok(ids.has(id), `${name}: ${id}`);
        checked++;
      }
    }
  }
  assert.equal(checked, 34); // every ticket of every accepted block, tiny and full
});

test("η′ of 198 real blocks: η₀ stirred with each header's VRF output, at last", () => {
  for (const family of ["fallback", "safrole"]) {
    for (let n = 1; n < 100; n++) {
      const { entries, block } = traceState(family, n);
      const header: Header = Block(TINY).fromJson(block).header;
      const newEpoch: boolean = epochOf(TINY, header.slot) > epochOf(TINY, readTime(entries));
      const output: Bytes = vrfOutput(header.entropy_source);
      const eta: string[] = nextEntropy(readEntropy(entries), output, newEpoch).map(toHex);
      const after: string[] = readEntropy(traceState(family, n + 1).entries).map(toHex);
      assert.deepEqual(eta, after, `${family} block ${n}`);
    }
  }
});