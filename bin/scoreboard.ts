// The scoreboard: every official test vector, run whole by the family your client has for
// it, and counted. A vector passes only if your client's answer is all of the vector's.
// Usage: npm run scoreboard

import { readdirSync } from "node:fs";
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

const rows = new Map<string, Row>();
const run = new Run("scoreboard");
for (const { folder, names } of folders()) {
  const row = rows.get(rowOf(folder)) ?? { passed: 0, total: 0, run: false, failures: [] };
  rows.set(rowOf(folder), row);
  row.total += names.length;
  const family = FAMILIES.find((f) => f.folders.includes(folder));
  if (!family) continue; // not run yet
  row.run = true;
  for (const name of names) {
    let why: string | null = null; // null: it passed
    try {
      family.check(name);
    } catch (e) {
      why = (e as Error).message.split("\n")[0];
    }
    if (why === null) row.passed++;
    else row.failures.push(`${name}: ${why}`);
    run.event("vector", { family: rowOf(folder), vector: name, passed: why === null, why });
  }
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
