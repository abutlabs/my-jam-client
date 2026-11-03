// A worker thread of bin/scoreboard.ts: it runs each vector it's handed with its family's
// check, and says whether it passed, and if not, why.

import { parentPort } from "node:worker_threads";
import { FAMILIES } from "./families.ts";

parentPort!.on("message", ({ folder, name }: { folder: string; name: string }) => {
  const family = FAMILIES.find((f) => f.folders.includes(folder))!;
  try {
    family.check(name);
    parentPort!.postMessage({ name, why: null });
  } catch (e) {
    parentPort!.postMessage({ name, why: (e as Error).message.split("\n")[0] });
  }
});
