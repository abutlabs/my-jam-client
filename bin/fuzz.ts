// A small fuzzer of your own: plays the conformance fuzzer's part (fuzz-proto) with a
// block-import trace, against a target. It starts bin/target.ts itself, unless given the
// socket of a target already running. Each state root is checked against the trace's.
// Usage: npm run fuzz [family] [socket], "fallback" and a fresh target if not given

import { spawn } from "node:child_process";
import type { Socket } from "node:net";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Block, Header, headerHash } from "../src/block.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { decode, encode } from "../src/codec/codec.ts";
import { TINY } from "../src/config.ts";
import type { Message } from "../src/fuzz.ts";
import { MessageCodec, frame, readFrames } from "../src/fuzz.ts";
import { Run } from "../src/obs.ts";
import { vectorJson } from "../test/vectors.ts";

type Entries = { key: string; value: string }[];
type Genesis = { header: unknown; state: { state_root: string; keyvals: Entries } };
type TraceStep = {
  pre_state: { state_root: string };
  block: unknown;
  post_state: { state_root: string };
};

const family = process.argv[2] ?? "fallback";
const given = process.argv[3]; // a target already running, if any
const path = given ?? join(tmpdir(), `the-gray-tutor-${process.pid}.sock`);
const start = () => spawn(process.execPath, ["bin/target.ts", path], { stdio: "ignore" });
const target = given ? undefined : start();
/** Connects to the target, trying again for a few seconds while it starts. */
async function connectTo(path: string): Promise<Socket> {
  for (let tries = 0; ; tries++) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = connect(path);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (e) {
      if (tries === 100) throw e; // five seconds, and no target
      await sleep(50);
    }
  }
}

const codec = MessageCodec(TINY);
const socket = await connectTo(path);
const replies = readFrames(socket)[Symbol.asyncIterator]();

/** Sends a message and waits for the target's answer. */
async function ask(message: Message): Promise<Message> {
  socket.write(frame(encode(codec, message)));
  const { value } = await replies.next();
  return decode(codec, value!);
}

const run = new Run("fuzz");
const hello = await ask({
  kind: "peer_info",
  value: {
    fuzz_version: 1,
    fuzz_features: 1 | 2, // ancestry and forks
    jam_version: { major: 0, minor: 8, patch: 0 },
    app_version: { major: 0, minor: 1, patch: 0 },
    app_name: new TextEncoder().encode("the-gray-tutor-fuzzer"),
  },
});
const app = hello.kind === "peer_info" ? new TextDecoder().decode(hello.value.app_name) : "?";
console.log(`target: ${app}`);

const genesis = vectorJson(`traces/${family}/genesis.json`) as Genesis;
const header = Header(TINY).fromJson(genesis.header);
const keyvals = genesis.state.keyvals.map((e) => ({
  key: fromHex(e.key),
  value: fromHex(e.value),
}));
const ancestry = [{ slot: header.slot, header_hash: headerHash(TINY, header) }];
const first = await ask({ kind: "initialize", value: { header, keyvals, ancestry } });
const genesisOk =
  first.kind === "state_root" && toHex(first.value) === genesis.state.state_root;
console.log(`initialize: ${genesisOk ? "the genesis root" : "a wrong root"}`);

let agreed = 0;
for (let n = 1; n <= 100; n++) {
  const step = vectorJson(`traces/${family}/${String(n).padStart(8, "0")}.json`) as TraceStep;
  const block = Block(TINY).fromJson(step.block);
  const reply = await ask({ kind: "import_block", value: block });
  const refused = step.post_state.state_root === step.pre_state.state_root;
  const rootOk = reply.kind === "state_root" && toHex(reply.value) === step.post_state.state_root;
  const ok = refused ? reply.kind === "error" : rootOk;
  const why = reply.kind === "error" ? new TextDecoder().decode(reply.value) : "";
  const said = reply.kind === "error" ? `refused, ${why}` : "a root";
  run.event("block", { n, slot: block.header.slot, said, ok });
  if (ok) {
    agreed++;
    continue;
  }
  console.log(`block ${n}: ${said}, not what the trace says`);
  const state = await ask({ kind: "get_state", value: headerHash(TINY, block.header) });
  const entries = state.kind === "state" ? state.value.length : 0;
  console.log(`the target's state there: ${entries} entries`);
  break;
}
console.log(`${agreed} of 100 blocks as the trace has them`);
run.event("done", { family, agreed });
socket.end();
target?.kill();
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
