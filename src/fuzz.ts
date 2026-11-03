// The conformance fuzzer's protocol (jam-conformance fuzz-proto, version 1): the messages
// the fuzzer and a client send each other over a Unix socket, in the JAM codec.

import type { Bytes } from "./bytes.ts";
import { concatBytes } from "./bytes.ts";
import type { Codec, Value } from "./codec/codec.ts";
import { blob, fixedBytes, hash, record, seq, u8, u32 } from "./codec/codec.ts";
import type { Config } from "./config.ts";
import { Block, Header } from "./block.ts";

/** A version, as three bytes: major, minor, patch. */
const Version = record({ major: u8, minor: u8, patch: u8 });

/** Who's talking, and what they can do: the first message each side sends. */
export const PeerInfo = record({
  fuzz_version: u8, // the protocol's version: 1
  fuzz_features: u32, // bits: 1 for ancestry, 2 for forks
  jam_version: Version, // the Gray Paper's: 0.8.0
  app_version: Version,
  app_name: blob, // UTF-8, its length first
});
export type PeerInfo = Value<typeof PeerInfo>;

/** One entry of a state, as the fuzzer sends it: a 31-byte key and its value. */
const KeyValueCodec = record({ key: fixedBytes(31), value: blob });

/** A block the client may need as a lookup anchor: its slot and its header's hash. */
export const AncestryItem = record({ slot: u32, header_hash: hash });
export type AncestryItem = Value<typeof AncestryItem>;

/** Initialize: the state to start from, a header to name it by, and its ancestors. */
export function Initialize(config: Config) {
  return record({
    header: Header(config), // a header to name the state by: its hash
    keyvals: seq(KeyValueCodec), // the state, as entries
    ancestry: seq(AncestryItem), // the last L blocks, this one's header included
  });
}

/** A message, either way: its kind and what it carries. */
export type Message =
  | { kind: "peer_info"; value: PeerInfo }
  | { kind: "initialize"; value: Value<ReturnType<typeof Initialize>> }
  | { kind: "state_root"; value: Bytes }
  | { kind: "import_block"; value: Block }
  | { kind: "get_state"; value: Bytes } // a header's hash
  | { kind: "state"; value: { key: Bytes; value: Bytes }[] }
  | { kind: "error"; value: Bytes }; // UTF-8 text, for whoever reads the logs

/** Each kind of message: the byte it starts with, and how the rest is encoded. */
function kinds(config: Config): Record<Message["kind"], [number, Codec<any>]> {
  return {
    peer_info: [0, PeerInfo],
    initialize: [1, Initialize(config)],
    state_root: [2, hash],
    import_block: [3, Block(config)],
    get_state: [4, hash],
    state: [5, seq(KeyValueCodec)],
    error: [255, blob],
  };
}

/** A message (fuzz-proto): one byte for its kind, then what it carries. */
export function MessageCodec(config: Config): Codec<Message> {
  const all = Object.entries(kinds(config)) as [Message["kind"], [number, Codec<any>]][];
  return {
    encode: (w, m) => {
      const [tag, codec] = kinds(config)[m.kind];
      w.fixed(BigInt(tag), 1);
      codec.encode(w, m.value);
    },
    decode: (r) => {
      const tag = Number(r.fixed(1));
      const found = all.find(([, [t]]) => t === tag);
      if (!found) throw new Error(`no message starts with ${tag}`);
      const [kind, [, codec]] = found;
      return { kind, value: codec.decode(r) } as Message;
    },
    fromJson: () => {
      throw new Error("messages come as bytes");
    },
  };
}

/** The fuzzer's frame: every message is sent as its length, four bytes, then itself. */
export function frame(message: Bytes): Bytes {
  const framed = new Uint8Array(4 + message.length);
  new DataView(framed.buffer).setUint32(0, message.length, true);
  framed.set(message, 4);
  return framed;
}

/** The messages in a stream of frames, one at a time, however the bytes arrive. */
export async function* readFrames(stream: AsyncIterable<Uint8Array>): AsyncGenerator<Bytes> {
  let buffer: Bytes = new Uint8Array(0);
  for await (const chunk of stream) {
    buffer = concatBytes(buffer, chunk);
    while (buffer.length >= 4) {
      const length = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, true);
      if (buffer.length < 4 + length) break; // the rest is still on its way
      yield buffer.slice(4, 4 + length);
      buffer = buffer.slice(4 + length);
    }
  }
}
