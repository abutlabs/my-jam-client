// Programs (GP §9, App. A): how a service's code is packed, from its preimage down to the
// instructions the PVM runs.

import { bitAt } from "../assurances.ts";
import type { Bytes } from "../bytes.ts";
import { Reader } from "../codec/reader.ts";

/** A service's code, unpacked: its metadata, and the standard program's parts (GP App. A). */
export type ServiceCode = {
  metadata: Bytes; // a name, a version, a licence: for people, not the PVM
  readOnly: Bytes; // o: data the program may read
  readWrite: Bytes; // w: data it may read and write
  heapPages: number; // z: pages of zeroed heap after w
  stackSize: number; // s
  program: Bytes; // the PVM program blob
};

/** Unpacks a code preimage: E(↕m) ⌢ c (GP §9), and c is Y's standard program (App. A). */
export function unpackCode(preimage: Bytes): ServiceCode {
  const r = new Reader(preimage);
  const metadata = r.bytes(Number(r.natural()));
  const readOnlyLength = Number(r.fixed(3));
  const readWriteLength = Number(r.fixed(3));
  const heapPages = Number(r.fixed(2));
  const stackSize = Number(r.fixed(3));
  const readOnly = r.bytes(readOnlyLength);
  const readWrite = r.bytes(readWriteLength);
  const program = r.bytes(Number(r.fixed(4)));
  return { metadata, readOnly, readWrite, heapPages, stackSize, program };
}

/** A PVM program blob, unpacked: the jump table, the code, and the opcode bitmask. */
export type Program = { jumpTable: number[]; code: Bytes; bitmask: Bytes };

/** deblob (GP App. A): E(|j|) ⌢ E₁(z) ⌢ E(|c|) ⌢ j, each entry z bytes ⌢ c ⌢ k. */
export function deblob(blob: Bytes): Program {
  const r = new Reader(blob);
  const jumps = Number(r.natural());
  const z = Number(r.fixed(1)); // bytes per jump-table entry
  const codeLength = Number(r.natural());
  const jumpTable = Array.from({ length: jumps }, () => Number(r.fixed(z)));
  const code = r.bytes(codeLength);
  const bitmask = r.bytes(Math.ceil(codeLength / 8)); // one bit per byte of code
  return { jumpTable, code, bitmask };
}

/** Whether byte i of the code starts an instruction: bit i of k, least significant first. */
export function startsInstruction(program: Program, i: number): boolean {
  return i < program.code.length && bitAt(program.bitmask, i);
}

/** A tiny assembler for hand-written programs: each array is one instruction's bytes. */
export function assemble(instructions: number[][]): Program {
  const code = Uint8Array.from(instructions.flat());
  const bitmask = new Uint8Array(Math.ceil(code.length / 8));
  let at = 0;
  for (const instruction of instructions) {
    bitmask[Math.floor(at / 8)] |= 1 << at % 8; // this byte starts an instruction
    at += instruction.length;
  }
  return { jumpTable: [], code, bitmask };
}
