// Reports each npm test run to the observability stack: each test's result as an event,
// the totals as numbers. Prints one line: where to see the run in Grafana.

import { relative } from "node:path";
import type { TestEvent } from "node:test/reporters";
import { Run } from "../src/obs.ts";

export default async function* grafana(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const run = new Run("test");
  let passed = 0;
  let failed = 0;
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const { name, file, details } = event.data;
    if (details.type === "suite") continue;
    const ok = event.type === "test:pass";
    const error = event.type === "test:fail" ? String(event.data.details.error.cause) : undefined;
    if (ok) passed++;
    else failed++;
    const where = file && relative(process.cwd(), file);
    run.event("test", { name, file: where, ok, ms: Math.round(details.duration_ms), error });
  }
  run.number("tests_passed", passed);
  run.number("tests_failed", failed);
  const link = await run.report();
  if (link) yield `reported ${passed + failed} tests to Grafana: ${link}\n`;
}