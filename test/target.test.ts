import { test } from "node:test";
import assert from "node:assert/strict";
import { Block, Header, headerHash } from "../src/block.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { TINY } from "../src/config.ts";
import type { Message } from "../src/fuzz.ts";
import type { Session } from "../src/target.ts";
import { answer, newSession } from "../src/target.ts";
import { vectorJson } from "./vectors.ts";

type Entries = { key: string; value: string }[];
type Genesis = { header: unknown; state: { state_root: string; keyvals: Entries } };
type TraceStep = { block: unknown; post_state: { state_root: string; keyvals: Entries } };

/** The fuzzer's first two messages for a trace: a PeerInfo, and Initialize with genesis. */
function opening(family: string, features: number): Message[] {
  const genesis = vectorJson(`traces/${family}/genesis.json`) as Genesis;
  const header = Header(TINY).fromJson(genesis.header);
  const keyvals = genesis.state.keyvals.map((e) => ({
    key: fromHex(e.key),
    value: fromHex(e.value),
  }));
  const version = { major: 0, minor: 8, patch: 0 };
  const peer = {
    fuzz_version: 1,
    fuzz_features: features,
    jam_version: version,
    app_version: version,
    app_name: new TextEncoder().encode("test"),
  };
  const ancestry = [{ slot: 0, header_hash: headerHash(TINY, header) }];
  return [
    { kind: "peer_info", value: peer },
    { kind: "initialize", value: { header, keyvals, ancestry } },
  ];
}

/** Block n of a trace, as an ImportBlock message, and the trace's state after it. */
function importing(family: string, n: number) {
  const step = vectorJson(`traces/${family}/${String(n).padStart(8, "0")}.json`) as TraceStep;
  const message: Message = { kind: "import_block", value: Block(TINY).fromJson(step.block) };
  return { message, after: step.post_state };
}

test("a session: a handshake, genesis, ten blocks with each root the trace's, a state", () => {
  const session: Session = newSession();
  const [hello, initialize] = opening("storage", 1); // the fuzzer offers ancestry only
  const reply = answer(TINY, session, hello);
  assert.equal(reply?.kind, "peer_info");
  assert.equal(session.features, 1); // what both can do: 1 & (1 | 2)
  const genesis = vectorJson("traces/storage/genesis.json") as Genesis;
  const first = answer(TINY, session, initialize);
  assert.deepEqual(first, { kind: "state_root", value: fromHex(genesis.state.state_root) });
  for (let n = 1; n <= 10; n++) {
    const { message, after } = importing("storage", n);
    const root = answer(TINY, session, message);
    assert.deepEqual(root, { kind: "state_root", value: fromHex(after.state_root) }, `block ${n}`);
  }
  const { message, after } = importing("storage", 10);
  const hash = headerHash(TINY, (message as { value: Block }).value.header);
  const state = answer(TINY, session, { kind: "get_state", value: hash });
  const entries: number = state?.kind === "state" ? state.value.length : 0;
  assert.equal(entries, after.keyvals.length);
});

test("a block whose parent the target never saw: an Error; a second Initialize: goodbye", () => {
  const session: Session = newSession();
  const [hello, initialize] = opening("fallback", 3);
  answer(TINY, session, hello);
  answer(TINY, session, initialize);
  const { message } = importing("fallback", 5); // its parent, block 4, never came
  const reply = answer(TINY, session, message);
  const said: string = reply?.kind === "error" ? new TextDecoder().decode(reply.value) : "";
  assert.equal(said, "the parent block is unknown");
  const again = answer(TINY, session, initialize);
  assert.equal(again, null); // close the connection
});
