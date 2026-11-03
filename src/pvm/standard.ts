// The standard program (GP App. A.7, Y): how a service's program starts. Its data, heap,
// stack and arguments are laid out in memory, and a few registers say where things are.

import type { Bytes } from "../bytes.ts";
import type { Memory } from "./memory.ts";
import { addPages, PAGE_SIZE } from "./memory.ts";
import type { ServiceCode } from "./program.ts";

/** Z_Z: memory is laid out in zones of 64 KiB. */
export const ZONE = 2 ** 16;
/** Z_I: room for up to 16 MiB of arguments. */
export const INPUT_SIZE = 2 ** 24;

/** x rounded up to a whole number of `size`s: the GP's P (pages) and Q (zones). */
export const roundUp = (x: number, size: number) => Math.ceil(x / size) * size;

/** Copies bytes into memory at `address`, whatever the pages allow: setting up is allowed. */
function place(memory: Memory, address: number, bytes: Bytes): void {
  bytes.forEach((byte, k) => {
    const i = address + k;
    memory.get(Math.floor(i / PAGE_SIZE))!.bytes[i % PAGE_SIZE] = byte;
  });
}

/** Y (GP App. A.7): a standard program's memory and registers at the start, given arguments. */
export function standardProgram(code: ServiceCode, args: Bytes) {
  const { readOnly, readWrite, heapPages, stackSize } = code;
  const memory: Memory = new Map();
  addPages(memory, ZONE, readOnly.length, "R"); // o, one zone up
  place(memory, ZONE, readOnly);
  const heap = 2 * ZONE + roundUp(readOnly.length, ZONE); // w, a zone after o's zones
  addPages(memory, heap, roundUp(readWrite.length, PAGE_SIZE) + heapPages * PAGE_SIZE, "W");
  place(memory, heap, readWrite);
  const stackTop = 2 ** 32 - 2 * ZONE - INPUT_SIZE; // the stack grows down from here
  const stack = roundUp(stackSize, PAGE_SIZE);
  addPages(memory, stackTop - stack, stack, "W");
  const input = 2 ** 32 - ZONE - INPUT_SIZE; // the arguments, read only
  addPages(memory, input, args.length, "R");
  place(memory, input, args);
  const registers = Array<bigint>(13).fill(0n);
  registers[0] = 2n ** 32n - 2n ** 16n; // the halt address: returning from the program ends it
  registers[1] = BigInt(stackTop); // the stack pointer
  registers[7] = BigInt(input); // where the arguments are,
  registers[8] = BigInt(args.length); // and how long they are
  return { memory, registers };
}
