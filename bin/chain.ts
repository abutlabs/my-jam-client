// Walks the 100 blocks of a tiny trace ("fallback", unless you name another) and checks
// each one: does it name the hash of the block before it as its parent, and does its
// header's extrinsic hash match the extrinsic it carries?

import { readFileSync } from "node:fs";
import { Block, extrinsicHash, headerHash } from "../src/block.ts";
import type { Bytes } from "../src/bytes.ts";
import { toHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import { Run } from "../src/obs.ts";

const trace = process.argv[2] ?? "fallback";
const run = new Run("chain");
let previous: Bytes | null = null; // the hash of the last block's header
let holding = 0;
let matching = 0;
for (let n = 1; n <= 100; n++) {
  const file = `../vectors/traces/${trace}/${String(n).padStart(8, "0")}.json`;
  const json = JSON.parse(readFileSync(file, "utf8"));
  const { header, extrinsic } = Block(TINY).fromJson(json.block);
  const hash = headerHash(TINY, header);
  const linked = previous !== null && toHex(header.parent) === toHex(previous);
  if (linked) holding++;
  const matches = toHex(extrinsicHash(TINY, extrinsic)) === toHex(header.extrinsic_hash);
  if (matches) matching++;
  run.event("block", { slot: header.slot, hash, parent: header.parent, linked, matches });
  previous = hash;
}
console.log(`${holding} of 99 links hold.`);
console.log(`${matching} of 100 extrinsics match their headers.`);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
