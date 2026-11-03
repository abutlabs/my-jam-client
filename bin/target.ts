// Your client as a fuzz target: listens on a Unix socket, and answers the conformance
// fuzzer's messages (fuzz-proto), one session after another, until stopped (Ctrl+C).
// Usage: npm run target [socket], /tmp/jam_target.sock if not given; or, as the
// official fuzzer starts it, with JAM_FUZZ, JAM_FUZZ_SPEC, JAM_FUZZ_DATA_PATH and
// JAM_FUZZ_SOCK_PATH set, and no arguments.

import { chmodSync, existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { toHex } from "../src/bytes.ts";
import { decode, encode } from "../src/codec/codec.ts";
import { FULL, TINY } from "../src/config.ts";
import { MessageCodec, frame, readFrames } from "../src/fuzz.ts";
import type { Message } from "../src/fuzz.ts";
import { Run } from "../src/obs.ts";
import { answer, newSession } from "../src/target.ts";

const fuzzing = process.env.JAM_FUZZ !== undefined; // started by the official fuzzer
const needed = ["JAM_FUZZ_SPEC", "JAM_FUZZ_DATA_PATH", "JAM_FUZZ_SOCK_PATH"];
const missing = needed.filter((name) => !process.env[name]);
if (fuzzing && missing.length > 0) {
  console.log(`refusing to start: ${missing.join(", ")} not set`);
  process.exit(1);
}
const config = fuzzing && process.env.JAM_FUZZ_SPEC === "full" ? FULL : TINY;
const path = (fuzzing ? process.env.JAM_FUZZ_SOCK_PATH : process.argv[2]) ?? "/tmp/jam_target.sock";
const codec = MessageCodec(config);
if (existsSync(path)) rmSync(path); // a socket left by an earlier run

/** One line about a message, for the console and Grafana. */
function describe(m: Message): string {
  if (m.kind === "peer_info") return `peer_info from ${new TextDecoder().decode(m.value.app_name)}`;
  if (m.kind === "import_block") return `import_block, slot ${m.value.header.slot}`;
  if (m.kind === "state_root") return `state_root ${toHex(m.value).slice(0, 10)}…`;
  if (m.kind === "error") return `error: ${new TextDecoder().decode(m.value)}`;
  if (m.kind === "state") return `state, ${m.value.length} entries`;
  return m.kind;
}

const server = createServer(async (socket) => {
  const session = newSession();
  const run = new Run("target");
  try {
    for await (const bytes of readFrames(socket)) {
      const request = decode(codec, bytes);
      const reply = answer(config, session, request);
      const said = reply ? describe(reply) : "closing";
      console.log(`${describe(request)} → ${said}`);
      run.event("message", { request: describe(request), reply: said });
      if (!reply) break;
      socket.write(frame(encode(codec, reply)));
    }
  } catch (e) {
    console.log(`closing: ${(e as Error).message}`); // a message no codec could read
  }
  socket.end();
  const link = await run.report();
  if (link) console.log(`session over; reported to Grafana: ${link}`);
});
/** Stopping (Ctrl+C, or kill): the socket's file goes too, so no fuzzer finds a dead one. */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    rmSync(path, { force: true });
    process.exit(0);
  });
}
server.listen(path, () => {
  chmodSync(path, 0o666); // the fuzzer may run as another user
  console.log(`listening on ${path}`);
});
