import { test } from "node:test";
import assert from "node:assert/strict";
import { Block, Header, headerHash } from "../src/block.ts";
import type { Bytes } from "../src/bytes.ts";
import { concatBytes, fromHex, toHex } from "../src/bytes.ts";
import { decode, encode } from "../src/codec/codec.ts";
import { TINY } from "../src/config.ts";
import type { Message } from "../src/fuzz.ts";
import { MessageCodec, frame, readFrames } from "../src/fuzz.ts";
import { vectorJson } from "./vectors.ts";

/** The protocol README's three examples: a PeerInfo, a StateRoot and an Error. */
const EXAMPLES = [
  "0x0001020000000007000001190666757a7a6572",
  "0x024559342d3a32a8cbc3c46399a80753abff8bf785aa9d6f623e0de045ba6701fe",
  "0xff4c436861696e206572726f723a20626c6f636b20657865637574696f6e206661696c7572653a20" +
    "707265696d61676573206572726f723a20707265696d616765206e6f74207265717569726564",
];

test("the protocol's examples decode, and encode back byte for byte", () => {
  const codec = MessageCodec(TINY);
  const kinds: string[] = [];
  for (const example of EXAMPLES) {
    const message: Message = decode(codec, fromHex(example));
    kinds.push(message.kind);
    const back: string = toHex(encode(codec, message));
    assert.equal(back, example);
  }
  assert.deepEqual(kinds, ["peer_info", "state_root", "error"]);
  const hello: Message = decode(codec, fromHex(EXAMPLES[0]));
  const name: string =
    hello.kind === "peer_info" ? new TextDecoder().decode(hello.value.app_name) : "";
  assert.equal(name, "fuzzer");
});

test("Initialize and ImportBlock, made from a trace, round-trip too", () => {
  const codec = MessageCodec(TINY);
  const genesis = vectorJson("traces/storage/genesis.json") as { header: unknown; state: unknown };
  const header = Header(TINY).fromJson(genesis.header);
  const keyvals = (genesis.state as { keyvals: { key: string; value: string }[] }).keyvals
    .map((e) => ({ key: fromHex(e.key), value: fromHex(e.value) }));
  const ancestry = [{ slot: header.slot, header_hash: headerHash(TINY, header) }];
  const step = vectorJson("traces/storage/00000010.json") as { block: unknown };
  for (const message of [
    { kind: "initialize", value: { header, keyvals, ancestry } },
    { kind: "import_block", value: Block(TINY).fromJson(step.block) },
  ] as Message[]) {
    const bytes: Bytes = encode(codec, message);
    const decoded: Message = decode(codec, bytes);
    assert.deepEqual(decoded, message, message.kind);
  }
});

test("frames: a length in four bytes, then the message, however the bytes arrive", async () => {
  const framed: Bytes = frame(fromHex(EXAMPLES[1]));
  assert.equal(toHex(framed.subarray(0, 4)), "0x21000000"); // 33 bytes, little end first
  const both: Bytes = concatBytes(framed, frame(fromHex(EXAMPLES[0])));
  async function* inPieces() { // three bytes at a time, as a slow socket might deliver them
    for (let i = 0; i < both.length; i += 3) yield both.slice(i, i + 3);
  }
  const messages: string[] = [];
  for await (const message of readFrames(inPieces())) messages.push(toHex(message));
  assert.deepEqual(messages, [EXAMPLES[1], EXAMPLES[0]]);
});
