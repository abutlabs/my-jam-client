// The official test vectors, family by family, each run whole: your client's answer to a
// vector must be all of the vector's answer. bin/scoreboard.ts runs them and counts.

import assert from "node:assert/strict";
import type { Codec } from "../src/codec/codec.ts";
import { RefineContext, WorkItem } from "../src/work.ts";
import { checkCodecVector } from "./vectors.ts";

/** A family of official vectors: the folders of vectors/ it fills, and a check that runs
 * one vector whole and throws if your client's answer differs from it anywhere. */
export type Family = { folders: string[]; check: (name: string) => void };

/** Every family your client runs so far. */
export const FAMILIES: Family[] = [
  { folders: ["codec/tiny", "codec/full"], check: checkCodec },
];

/** The codecs for the codec vectors so far, by the vectors' names for the structures. */
const CODECS: Record<string, Codec<unknown>> = {
  refine_context: RefineContext,
  work_item: WorkItem,
};

/** A codec vector, such as "codec/tiny/work_item.json", by its round trip. */
function checkCodec(name: string) {
  const structure = name.split("/").at(-1)!.replace(".json", "");
  const codec = CODECS[structure];
  assert.ok(codec, `no codec for ${structure} yet`);
  checkCodecVector(codec, name.replace(".json", ""));
}