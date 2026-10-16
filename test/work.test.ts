import { test } from "node:test";
import { RefineContext, WorkItem, WorkPackage, WorkDigest, WorkResult, WorkReport } from "../src/work.ts";
import { checkCodecVector } from "./vectors.ts";


import assert from "node:assert/strict";
import { fromHex, toHex } from "../src/bytes.ts";
import { encode } from "../src/codec/codec.ts";

for (const spec of ["tiny", "full"]) {
  const dir = `codec/${spec}`;
  test(`refine_context (${spec})`, () => checkCodecVector(RefineContext, `${dir}/refine_context`));
  test(`work_item (${spec})`, () => checkCodecVector(WorkItem, `${dir}/work_item`));
}

for (const spec of ["tiny", "full"]) {
  test(`work_package (${spec})`, () => checkCodecVector(WorkPackage, `codec/${spec}/work_package`));
}

test("a result is tag 0 and the output, or just an error's tag", () => {
  const okHex: string = toHex(encode(WorkResult, { ok: fromHex("0xaabbcc") }));
  assert.equal(okHex, "0x0003aabbcc");
  const outOfGasHex: string = toHex(encode(WorkResult, { error: "out_of_gas" }));
  assert.equal(outOfGasHex, "0x01");
  const panicHex: string = toHex(encode(WorkResult, { error: "panic" }));
  assert.equal(panicHex, "0x02");
});

for (const spec of ["tiny", "full"]) {
  const dir = `codec/${spec}`;
  test(`work_result_0 (${spec})`, () => checkCodecVector(WorkDigest, `${dir}/work_result_0`));
  test(`work_result_1 (${spec})`, () => checkCodecVector(WorkDigest, `${dir}/work_result_1`));
}

for (const spec of ["tiny", "full"]) {
  test(`work_report (${spec})`, () => checkCodecVector(WorkReport, `codec/${spec}/work_report`));
}