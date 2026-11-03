// Provides the preimages of a trace's block to the services that asked for them, and shows
// each request's history before and after.
// Usage: npm run preimages <trace.json>, e.g.
//        npm run preimages ../vectors/traces/preimages/00000008.json

import { readFileSync } from "node:fs";
import { Block } from "../src/block.ts";
import type { Bytes } from "../src/bytes.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { decode } from "../src/codec/codec.ts";
import { TINY } from "../src/config.ts";
import { blake2b256 } from "../src/hash.ts";
import { Run } from "../src/obs.ts";
import { providePreimages, RequestHistory } from "../src/services.ts";
import { requestKey } from "../src/state.ts";
import type { KeyValue } from "../src/trie.ts";

const [file] = process.argv.slice(2);
const trace = JSON.parse(readFileSync(file, "utf8"));
const entries: KeyValue[] = trace.pre_state.keyvals.map((e: { key: string; value: string }) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const { header, extrinsic } = Block(TINY).fromJson(trace.block);
const after = providePreimages(entries, extrinsic.preimages, header.slot);

/** A request's history in a state, as a list of slots, or "none" if there's no request. */
function history(state: KeyValue[], key: Bytes): string {
  const entry = state.find((e) => toHex(e.key) === toHex(key));
  return entry ? `[${decode(RequestHistory, entry.value).join(", ")}]` : "none";
}

const run = new Run("preimages");
console.log(`block at slot ${header.slot}: ${extrinsic.preimages.length} preimages`);
for (const { requester, blob } of extrinsic.preimages) {
  const hash = blake2b256(blob);
  const request = requestKey(requester, hash, blob.length);
  const [was, now] = [history(entries, request), history(after, request)];
  const what = `${blob.length} bytes, hash ${toHex(hash).slice(0, 10)}…`;
  console.log(`service ${requester}: ${what}  request ${was} → ${now}`);
  run.event("provided", { service: requester, bytes: blob.length, hash, was, now });
}
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
