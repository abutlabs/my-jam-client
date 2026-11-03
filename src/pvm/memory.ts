// Memory (GP §4, App. A): 2^32 bytes in pages of 4096. Each page is readable, writable
// (and readable), or not there at all.

import type { Bytes } from "../bytes.ts";

/** Z_P: the size of a page. */
export const PAGE_SIZE = 4096;

/** A page's access: R, read only, or W, read and write. Pages not in memory have neither. */
export type Access = "R" | "W";

/** RAM, by page number: only the pages a program can touch are here. */
export type Memory = Map<number, { access: Access; bytes: Uint8Array }>;

/** What can go wrong touching memory: a panic below 2^16, or a fault at a page's address. */
export type MemoryError = "panic" | { fault: number };

/** Makes the pages covering [start, start + length) accessible, zeroed, with `access`. */
export function addPages(memory: Memory, start: number, length: number, access: Access): void {
  const first = Math.floor(start / PAGE_SIZE);
  const last = Math.ceil((start + length) / PAGE_SIZE);
  for (let page = first; page < last; page++) {
    memory.set(page, { access, bytes: new Uint8Array(PAGE_SIZE) });
  }
}

/** The addresses of n bytes from `address`, wrapping round at 2^32 (the GP's ↻). */
function addresses(address: bigint, n: number): number[] {
  return Array.from({ length: n }, (_, k) => Number((address + BigInt(k)) % 2n ** 32n));
}

/** ε^μ (GP App. A.4): the lowest address that can't be used; below 2^16 it's a panic. */
function check(memory: Memory, at: number[], write: boolean): MemoryError | null {
  const bad = at.filter((i) => {
    const page = memory.get(Math.floor(i / PAGE_SIZE));
    return page === undefined || (write && page.access !== "W");
  });
  if (bad.length === 0) return null;
  const lowest = Math.min(...bad);
  if (lowest < 2 ** 16) return "panic";
  return { fault: Math.floor(lowest / PAGE_SIZE) * PAGE_SIZE };
}

/** Reads n bytes from `address`, or says why it can't. */
export function readMemory(memory: Memory, address: bigint, n: number): Bytes | MemoryError {
  const at = addresses(address, n);
  const error = check(memory, at, false);
  if (error) return error;
  return Uint8Array.from(at, (i) => memory.get(Math.floor(i / PAGE_SIZE))!.bytes[i % PAGE_SIZE]);
}

/** Writes `bytes` at `address`, or says why it can't (and writes nothing). */
export function writeMemory(memory: Memory, address: bigint, bytes: Bytes): MemoryError | null {
  const at = addresses(address, bytes.length);
  const error = check(memory, at, true);
  if (error) return error;
  at.forEach((i, k) => {
    memory.get(Math.floor(i / PAGE_SIZE))!.bytes[i % PAGE_SIZE] = bytes[k];
  });
  return null;
}
