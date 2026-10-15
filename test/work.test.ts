import { test } from "node:test";
import { RefineContext, WorkItem } from "../src/work.ts";
import { checkCodecVector } from "./vectors.ts";

for (const spec of ["tiny", "full"]) {
  const dir = `codec/${spec}`;
  test(`refine_context (${spec})`, () => checkCodecVector(RefineContext, `${dir}/refine_context`));
  test(`work_item (${spec})`, () => checkCodecVector(WorkItem, `${dir}/work_item`));
}