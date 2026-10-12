// Says hello to the observability stack: your client's very first report.

import { Run } from "../src/obs.ts";

const run = new Run("hello");
run.event("hello", { message: "my JAM client is alive" });
run.number("hellos", 1);
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);