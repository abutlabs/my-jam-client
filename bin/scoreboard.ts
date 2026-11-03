// The scoreboard: every official test vector, run whole by the family your client has for
// it, and counted. A vector passes only if your client's answer is all of the vector's.
// The vectors run side by side, a worker thread per processor (test/family-worker.ts).
// Usage: npm run scoreboard

import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { Run } from "../src/obs.ts";
import { FAMILIES } from "../test/families.ts";
import { VECTORS } from "../test/vectors.ts";

/** Every folder of vectors/ that holds vectors, with their names ("codec/tiny/block.json").
 * A trace's genesis.json is the state it starts from, not a step, so not a vector. */
function folders(dir = ""): { folder: string; names: string[] }[] {
  const entries = readdirSync(VECTORS + dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const names = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json") && e.name !== "genesis.json")
    .map((e) => dir + e.name);
  const below = entries.filter((e) => e.isDirectory()).flatMap((e) => folders(`${dir}${e.name}/`));
  return names.length > 0 ? [{ folder: dir.slice(0, -1), names }, ...below] : below;
}

/** The row a folder counts on: tiny and full share one ("stf/safrole"). */
const rowOf = (folder: string) => folder.replace(/\/(tiny|full)$/, "");

/** A row of the scoreboard: how many passed, of how many, and why the others failed. */
type Row = { passed: number; total: number; run: boolean; failures: string[] };

/** A vector to run, and what a worker says of it: null if it passed, or why it failed. */
type Job = { folder: string; name: string };
type Result = { folder: string; name: string; why: string | null };

/** Runs every job on `threads` worker threads, each taking the next job when it's done. */
function runAll(jobs: Job[], threads: number): Promise<Result[]> {
  const queue = [...jobs];
  const results: Result[] = [];
  const thread = () => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("../test/family-worker.ts", import.meta.url));
    let job: Job | undefined;
    const next = () => {
      job = queue.shift();
      if (job) worker.postMessage(job);
      else worker.terminate().then(() => resolve());
    };
    worker.on("message", ({ why }: { why: string | null }) => {
      results.push({ ...job!, why });
      next();
    });
    worker.on("error", reject);
    next();
  });
  return Promise.all(Array.from({ length: threads }, thread)).then(() => results);
}

const rows = new Map<string, Row>();
const jobs: Job[] = [];
for (const { folder, names } of folders()) {
  const row = rows.get(rowOf(folder)) ?? { passed: 0, total: 0, run: false, failures: [] };
  rows.set(rowOf(folder), row);
  row.total += names.length;
  if (!FAMILIES.some((f) => f.folders.includes(folder))) continue; // not run yet
  row.run = true;
  for (const name of names) jobs.push({ folder, name });
}

const run = new Run("scoreboard");
const results = await runAll(jobs, availableParallelism());
results.sort((a, b) => a.name.localeCompare(b.name)); // threads finish in any order
for (const { folder, name, why } of results) {
  const row = rows.get(rowOf(folder))!;
  if (why === null) row.passed++;
  else row.failures.push(`${name}: ${why}`);
  run.event("vector", { family: rowOf(folder), vector: name, passed: why === null, why });
}

const n = (x: number) => x.toLocaleString("en-US"); // 1,428
console.log("The official test vectors, each run whole by your client:\n");
for (const [name, row] of rows) {
  const count = row.run ? `${n(row.passed)} of ${n(row.total)}`.padStart(10) : "";
  const mark = !row.run ? `not run yet (${n(row.total)})` : row.passed === row.total ? "✔" : "";
  console.log(`${name.padEnd(23)}${count}  ${mark}`.trimEnd());
  for (const failure of row.failures.slice(0, 3)) console.log(`    ✘ ${failure}`);
  if (row.failures.length > 3) console.log(`    … and ${row.failures.length - 3} more`);
  run.event("family", { family: name, passed: row.passed, total: row.total, run: row.run });
}
const passed = [...rows.values()].reduce((sum, row) => sum + row.passed, 0);
const total = [...rows.values()].reduce((sum, row) => sum + row.total, 0);
console.log(`\n${n(passed)} of ${n(total)} vectors pass.`);
run.number("vectors_passed", passed);
run.number("vectors_total", total);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
