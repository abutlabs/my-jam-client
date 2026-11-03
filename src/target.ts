// A fuzz target (fuzz-proto): the client's side of a session with the conformance fuzzer.
// It keeps every state it has made, by its block's header hash, and answers each message.

import { toHex } from "./bytes.ts";
import type { Config } from "./config.ts";
import { headerHash } from "./block.ts";
import type { Message, PeerInfo, AncestryItem } from "./fuzz.ts";
import { importBlock } from "./import.ts";
import type { KeyValue } from "./trie.ts";
import { stateRoot } from "./trie.ts";

/** The features this target supports (fuzz-proto): ancestry (1) and simple forks (2). */
const FEATURES = 1 | 2;

/** How this target introduces itself. */
const ME: PeerInfo = {
  fuzz_version: 1,
  fuzz_features: FEATURES,
  jam_version: { major: 0, minor: 8, patch: 0 },
  app_version: { major: 0, minor: 1, patch: 0 },
  app_name: new TextEncoder().encode("the-gray-tutor"),
};

/** A state the target has made: its entries, and the last L blocks of its chain. */
type Kept = { entries: KeyValue[]; ancestry: AncestryItem[] };

/** One session: the features both sides have, and every state made, by header hash. */
export type Session = { features: number; initialized: boolean; states: Map<string, Kept> };

/** A session before its handshake. */
export function newSession(): Session {
  return { features: 0, initialized: false, states: new Map() };
}

/** How many states a session keeps: forks are one block deep, so a few are plenty. */
const KEEP = 32;

/**
 * The target's answer to one of the fuzzer's messages (fuzz-proto), or null to close the
 * connection: after a second Initialize, or a message no target should get.
 */
export function answer(config: Config, session: Session, message: Message): Message | null {
  switch (message.kind) {
    case "peer_info":
      session.features = message.value.fuzz_features & FEATURES; // what both can do
      return { kind: "peer_info", value: ME };
    case "initialize": {
      if (session.initialized) return null; // one Initialize per session
      session.initialized = true;
      session.states.clear();
      const { header, keyvals, ancestry } = message.value;
      keep(session, toHex(headerHash(config, header)), { entries: keyvals, ancestry });
      return { kind: "state_root", value: stateRoot(keyvals) };
    }
    case "import_block": {
      const block = message.value;
      const parent = session.states.get(toHex(block.header.parent));
      if (!parent) return error("the parent block is unknown");
      const ancestry = session.features & 1 ? parent.ancestry : undefined;
      const after = importBlock(config, parent.entries, block, ancestry);
      if ("error" in after) return error(after.error); // the state stays as it was
      const hash = headerHash(config, block.header);
      const chain = [...parent.ancestry, { slot: block.header.slot, header_hash: hash }];
      const L = config.max_lookup_anchor_age;
      keep(session, toHex(hash), { entries: after, ancestry: chain.slice(-L) });
      return { kind: "state_root", value: stateRoot(after) };
    }
    case "get_state":
      return { kind: "state", value: session.states.get(toHex(message.value))?.entries ?? [] };
    default:
      return null; // the fuzzer never sends the other kinds
  }
}

/** An Error message, with a reason for whoever reads the logs. */
function error(reason: string): Message {
  return { kind: "error", value: new TextEncoder().encode(reason) };
}

/** Keeps a state under its header's hash, forgetting the oldest beyond KEEP. */
function keep(session: Session, hash: string, kept: Kept) {
  session.states.set(hash, kept);
  if (session.states.size > KEEP) session.states.delete(session.states.keys().next().value!);
}
