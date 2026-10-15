import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bytes } from "../src/bytes.ts";
import { concatBytes } from "../src/bytes.ts";
import { decode } from "../src/codec/codec.ts";
import { WorkItem } from "../src/work.ts";
import { vectorBytes } from "./vectors.ts";

type Field = { field: string; from: number; to: number; bytes: Bytes };

function traced(bytes: Bytes): Field[] {
  const fields: Field[] = [];
  decode(WorkItem, bytes, { event: (_step, f) => fields.push(f as Field) });
  return fields;
}

test("a decode trace names every innermost field, with where its bytes are", () => {
  const fields: Field[] = traced(vectorBytes("codec/tiny/work_item.bin"));
  const first: Field = fields[0];
  const service: Field = { field: "service", from: 0, to: 4, bytes: Uint8Array.of(4, 3, 2, 1) };
  assert.deepEqual(first, service);
  const names: string[] = fields.map((f) => f.field);
  for (const name of ["code_hash", "payload", "import_segments.length", "extrinsic.1.len"]) {
    const named: boolean = names.includes(name);
    assert.ok(named, name);
  }
});

test("the trace covers every byte, once, in order", () => {
  const bytes: Bytes = vectorBytes("codec/tiny/work_item.bin");
  const fields: Field[] = traced(bytes);
  for (let i = 1; i < fields.length; i++) {
    const from: number = fields[i].from;
    const previousTo: number = fields[i - 1].to;
    assert.equal(from, previousTo);
  }
  const joined: Bytes = concatBytes(...fields.map((f) => f.bytes));
  assert.deepEqual(joined, bytes);
});