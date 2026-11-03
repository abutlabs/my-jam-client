import { test } from "node:test";
import assert from "node:assert/strict";
import type { Host, HostExit, Accumulation, Accumulated, Outbox, Transfer, Privileges, Powers, Privileged, NewIds } from "../src/host.ts";
import { gas, HOST_CALLS, runWithHost, unknown, WHAT, accumulateHost, NONE, protocolConstants, growHeap, info, FULL, read, write, accumulate, checkpoint, collapse, lookup, forget, HUH, OK, query, solicit, CASH, collapseTransfers, LOW, transfer, WHO, assign, collapsePowers, CORE, startPowers, eject, newIds, newService, NO_PRIVILEGES, upgrade, yieldHash, collapseYield, provide, bless, designate } from "../src/host.ts";
import { HALT_ADDRESS, newMachine } from "../src/pvm/machine.ts";
import { assemble, deblob, unpackCode } from "../src/pvm/program.ts";
import type { Exit, Machine } from "../src/pvm/machine.ts";
import { TINY } from "../src/config.ts";
import { addPages, readMemory, writeMemory } from "../src/pvm/memory.ts";
import type { Bytes } from "../src/bytes.ts";
import type { MemoryError } from "../src/pvm/memory.ts";
import type { ServiceCode } from "../src/pvm/program.ts";
import { standardProgram } from "../src/pvm/standard.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { encodeNatural } from "../src/codec/numbers.ts";
import { vectorJson } from "./vectors.ts";
import type { Account, AccountJson } from "../src/services.ts";
import { accountFromJson, ServiceInfo, copyAccounts } from "../src/services.ts";
import { blake2b256 } from "../src/hash.ts";

/** A host that answers gas, and nothing else. */
const host: Host = (call, m) => (HOST_CALLS[call] === "gas" ? gas(m) : unknown(m));

/** ecalli `call`, then return through r0: one basic block, costing 100 gas. */
const calling = (call: number, budget: bigint) =>
  newMachine(assemble([[10, call], [50, 0x00]]), [HALT_ADDRESS], new Map(), budget);

test("gas: the program asks how much is left, pays 48 to ask, and carries on", () => {
  const machine: Machine = calling(0, 1000n);
  const exit: Exit = runWithHost(machine, host);
  assert.equal(exit, "halt"); // the return after the ecalli ran
  assert.equal(machine.registers[7], 1000n - 100n - 48n); // the block, then the question
});

test("a host call nobody knows: WHAT, for 1,000 gas", () => {
  const machine: Machine = calling(99, 2000n);
  const exit: Exit = runWithHost(machine, host);
  assert.equal(exit, "halt");
  assert.deepEqual([machine.registers[7], machine.gas], [WHAT, 900n]);
});

test("too poor to ask: a host call can run out of gas too", () => {
  const machine: Machine = calling(0, 147n); // 100 for the block leaves 47, and gas costs 48
  const exit: Exit = runWithHost(machine, host);
  assert.equal(exit, "oog");
  assert.equal(machine.registers[7], 0n); // no answer
});

test("28 host calls, numbered as in the GP: fetch is 2, provide 27", () => {
  const fetch: string = HOST_CALLS[2];
  const provide: string = HOST_CALLS[27];
  assert.deepEqual([fetch, provide, HOST_CALLS.length], ["fetch", "provide", 28]);
});

/** Accumulation's host, for service 0 with a tiny program, an entropy of sevens, no inputs. */
const accumulating = accumulateHost(TINY, {
  id: 0,
  accounts: tinyAccounts(),
  checkpoint: tinyAccounts(),
  code: tinyCode(),
  entropy: new Uint8Array(32).fill(7),
  inputs: [],
}, 0);

/** ecalli 2 (fetch) with φ₇ to φ₁₀ as given, then a return; a writable page at 0x20000. */
function fetching(o: bigint, from: bigint, length: bigint, item: bigint) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  const registers = [HALT_ADDRESS, 0n, 0n, 0n, 0n, 0n, 0n, o, from, length, item];
  return newMachine(assemble([[10, 2], [50, 0x00]]), registers, memory, 10_000n);
}

test("item 0: the protocol constants, 122 bytes, and tiny has 2 cores", () => {
  const constants: Bytes = protocolConstants(TINY);
  assert.equal(constants.length, 122);
  const cores: number[] = [...constants.subarray(24, 26)]; // C, after three 8-byte deposits
  assert.deepEqual(cores, [2, 0]);
});

test("fetch copies an item into memory, and says how long it is", () => {
  const machine: Machine = fetching(0x20000n, 0n, 122n, 0n);
  const exit: Exit = runWithHost(machine, accumulating);
  assert.equal(exit, "halt");
  assert.equal(machine.registers[7], 122n);
  const copied: Bytes | MemoryError = readMemory(machine.memory, 0x20000n, 122);
  const constants: Bytes = protocolConstants(TINY);
  assert.deepEqual(copied, constants);
  assert.equal(machine.gas, 10_000n - 100n - 390n); // the block, then fetch's item 0
});

test("asking for no bytes at all: just the length", () => {
  const machine: Machine = fetching(0x20000n, 0n, 0n, 0n);
  runWithHost(machine, accumulating);
  assert.equal(machine.registers[7], 122n);
  const untouched: Bytes | MemoryError = readMemory(machine.memory, 0x20000n, 1);
  assert.deepEqual(untouched, Uint8Array.of(0));
});

test("part of an item: from byte φ₈, and at most φ₉ bytes of it", () => {
  const machine: Machine = fetching(0x20000n, 30n, 10n, 1n); // the entropy, from byte 30: 2 left
  runWithHost(machine, accumulating);
  assert.equal(machine.registers[7], 32n);
  const copied: Bytes | MemoryError = readMemory(machine.memory, 0x20000n, 3);
  assert.deepEqual(copied, Uint8Array.of(7, 7, 0));
});

test("an item accumulation doesn't have: NONE; nowhere to put it: panic", () => {
  const missing: Machine = fetching(0x20000n, 0n, 10n, 7n); // a work-package: refinement only
  runWithHost(missing, accumulating);
  assert.equal(missing.registers[7], NONE);
  const nowhere: Exit = runWithHost(fetching(0x50000n, 0n, 122n, 0n), accumulating);
  assert.equal(nowhere, "panic");
});

/** A tiny standard program's parts: 3 bytes of o, 2 of w, a heap page, a 100-byte stack. */
function tinyCode(): ServiceCode {
  return {
    metadata: new Uint8Array(0),
    readOnly: Uint8Array.of(1, 2, 3),
    readWrite: Uint8Array.of(4, 5),
    heapPages: 1,
    stackSize: 100,
    program: new Uint8Array(0),
  };
}

/** A machine laid out as tinyCode's program, asking grow_heap for the heap to end at `want`. */
function growing(want: bigint) {
  const { memory, registers } = standardProgram(tinyCode(), new Uint8Array(0));
  registers[7] = want;
  return newMachine(assemble([[0]]), registers, memory, 10_000n);
}

test("grow_heap: w starts at page 48, and with its heap page the heap ends at 50", () => {
  const machine: Machine = growing(0n); // asking for no more than it has: just the answer
  const exit: HostExit = growHeap(machine, tinyCode());
  assert.equal(exit, "continue");
  assert.deepEqual([machine.registers[7], machine.gas], [50n, 10_000n - 275n]);
});

test("growing it by 3 pages costs 121 more gas a page, and page 52 is writable now", () => {
  const machine: Machine = growing(53n);
  const exit: HostExit = growHeap(machine, tinyCode());
  assert.equal(exit, "continue");
  assert.deepEqual([machine.registers[7], machine.gas], [53n, 10_000n - 275n - 3n * 121n]);
  const written: MemoryError | null = writeMemory(machine.memory, 52n * 4096n, Uint8Array.of(1));
  assert.equal(written, null);
});

/** The parts of an accumulate test vector these tests read. */
type AccumulateVector = {
  input: { slot: number };
  pre_state: {
    entropy: string;
    accounts: {
      id: number;
      data: AccountJson & {
        service: { code_hash: string };
        preimage_blobs: { hash: string; blob: string }[];
      };
    }[];
  };
  post_state: { statistics: { record: { accumulate_gas_used: number } }[] };
};

/** Service 1729's accumulation, set up as always_accumulate-1 has it: machine and host. */
function vectorService() {
  const { a, slot, expected } = vectorAccumulation();
  const [t, s] = [BigInt(slot), BigInt(a.id)]; // the slot, the service, no inputs
  const args = Uint8Array.from([...encodeNatural(t), ...encodeNatural(s), ...encodeNatural(0n)]);
  const { memory, registers } = standardProgram(a.code, args);
  const machine = newMachine(deblob(a.code.program), registers, memory, 100_000n);
  machine.pc = 5; // accumulation
  return { machine, host: accumulateHost(TINY, a, slot), expected };
}

test("service 1729 accumulates on exactly the 16,417 gas the test vector says", () => {
  const { machine, host, expected } = vectorService();
  const exit: Exit = runWithHost(machine, host);
  assert.equal(exit, "halt");
  const used: bigint = 100_000n - machine.gas;
  assert.equal(used, expected);
});

/** A service's record, made up: a balance of 1,000, 2 items in 50 bytes, created at slot 5. */
function tinyInfo(): ServiceInfo {
  return {
    version: 0,
    code_hash: new Uint8Array(32).fill(9),
    balance: 1000n,
    min_item_gas: 10n,
    min_memo_gas: 20n,
    bytes: 50n,
    deposit_offset: 0n,
    items: 2,
    creation_slot: 5,
    last_accumulation_slot: 0,
    parent_service: 0,
  };
}

/** The accounts the tests' accumulation sees: service 0, with tinyInfo's record. */
function tinyAccounts(): Map<number, Account> {
  const account = { info: tinyInfo(), storage: new Map(), preimages: new Map() };
  return new Map([[0, { ...account, requests: new Map() }]]);
}

/** A machine about to ask info about service `who`, with a writable page at 0x20000. */
function asking(who: bigint) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  const registers = [0n, 0n, 0n, 0n, 0n, 0n, 0n, who, 0x20000n, 0n, 96n];
  return newMachine(assemble([[0]]), registers, memory, 10_000n);
}

test("info: a service's record, 96 bytes, starting with its code hash", () => {
  const machine: Machine = asking(2n ** 64n - 1n); // 2^64 − 1: itself
  const exit: HostExit = info(machine, tinyAccounts(), 0);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], 96n);
  const start: Bytes | MemoryError = readMemory(machine.memory, 0x20000n, 33);
  assert.deepEqual(start, Uint8Array.of(...Array(32).fill(9), 232)); // then 1,000's low byte
  assert.equal(machine.gas, 10_000n - 703n);
});

test("its minimum balance comes worked out: 100 + 10 per item + 1 per byte = 170", () => {
  const machine: Machine = asking(0n); // service 0, by number this time
  info(machine, tinyAccounts(), 0);
  const minimum: Bytes | MemoryError = readMemory(machine.memory, 0x20000n + 40n, 2);
  assert.deepEqual(minimum, Uint8Array.of(170, 0));
});

test("info about a service that isn't there: NONE", () => {
  const machine: Machine = asking(42n);
  info(machine, tinyAccounts(), 0);
  assert.equal(machine.registers[7], NONE);
});

/** φ₇ on as given, and a writable page at 0x20000: the key "last" there, 1, 2, 3 at 0x20010. */
function storing(...r7on: bigint[]) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  writeMemory(memory, 0x20000n, new TextEncoder().encode("last"));
  writeMemory(memory, 0x20010n, Uint8Array.of(1, 2, 3));
  return newMachine(assemble([[0]]), [0n, 0n, 0n, 0n, 0n, 0n, 0n, ...r7on], memory, 10_000n);
}

test("write stores a value under a key, and the footprint grows", () => {
  const accounts: Map<number, Account> = tinyAccounts();
  const machine: Machine = storing(0x20000n, 4n, 0x20010n, 3n); // the key "last", the value 1, 2, 3
  const exit: HostExit = write(machine, accounts, 0);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], NONE); // nothing was there before
  const { info, storage }: Account = accounts.get(0)!;
  const stored: Bytes | undefined = storage.get("0x6c617374"); // "last", in hex
  assert.deepEqual(stored, Uint8Array.of(1, 2, 3));
  assert.deepEqual([info.items, info.bytes], [3, 50n + 34n + 4n + 3n]); // lesson 14.2's sums
  assert.equal(machine.gas, 10_000n - 2442n - 14n - 1n); // and per KiB of key and of value
});

test("read finds it again; writing an empty value deletes it", () => {
  const accounts: Map<number, Account> = tinyAccounts();
  write(storing(0x20000n, 4n, 0x20010n, 3n), accounts, 0);
  const reader: Machine = storing(2n ** 64n - 1n, 0x20000n, 4n, 0x20100n, 0n, 10n); // its own
  const exit: HostExit = read(reader, accounts, 0);
  assert.equal(exit, "continue");
  assert.equal(reader.registers[7], 3n);
  const value: Bytes | MemoryError = readMemory(reader.memory, 0x20100n, 3);
  assert.deepEqual(value, Uint8Array.of(1, 2, 3));
  const eraser: Machine = storing(0x20000n, 4n, 0n, 0n); // no value at all
  write(eraser, accounts, 0);
  assert.equal(eraser.registers[7], 3n); // the old value's length
  assert.equal(accounts.get(0)!.storage.size, 0);
});

test("FULL: a service can't keep more than its balance covers", () => {
  const accounts: Map<number, Account> = tinyAccounts(); // a balance of 1,000
  const machine: Machine = storing(0x20000n, 4n, 0x20010n, 1000n); // 1,000 bytes: a_t, 1,218
  write(machine, accounts, 0);
  assert.equal(machine.registers[7], FULL);
  assert.equal(accounts.get(0)!.storage.size, 0); // nothing changed
});

/** always_accumulate-1's service 1729 as an accumulation, its slot, and its gas to use. */
function vectorAccumulation() {
  const vector = vectorJson("stf/accumulate/tiny/always_accumulate-1.json") as AccumulateVector;
  const { id, data } = vector.pre_state.accounts[0];
  const preimage = data.preimage_blobs.find((p) => p.hash === data.service.code_hash)!;
  const accounts = new Map(vector.pre_state.accounts.map((a) => [a.id, accountFromJson(a.data)]));
  const a: Accumulation = {
    id,
    accounts,
    checkpoint: copyAccounts(accounts),
    code: unpackCode(fromHex(preimage.blob)),
    entropy: fromHex(vector.pre_state.entropy),
    inputs: [],
  };
  const expected = BigInt(vector.post_state.statistics[0].record.accumulate_gas_used);
  return { a, slot: vector.input.slot, expected };
}

/** Accumulation's bundle for service 0 of tinyAccounts, about to do something. */
function bundle(): Accumulation {
  const accounts = tinyAccounts();
  return {
    id: 0,
    accounts,
    checkpoint: copyAccounts(accounts),
    code: tinyCode(),
    entropy: new Uint8Array(0),
    inputs: [],
  };
}

test("a panic undoes every write since the last checkpoint", () => {
  const a: Accumulation = bundle();
  write(storing(0x20000n, 4n, 0x20010n, 3n), a.accounts, 0); // "last" → 1, 2, 3
  const afterHalt: Map<number, Account> = collapse(a, "halt"); // a halt keeps it
  assert.equal(afterHalt.get(0)!.storage.size, 1);
  const afterPanic: Map<number, Account> = collapse(a, "panic"); // a panic doesn't
  assert.equal(afterPanic.get(0)!.storage.size, 0);
});

test("checkpoint: what's done before it survives a panic after it", () => {
  const a: Accumulation = bundle();
  write(storing(0x20000n, 4n, 0x20010n, 3n), a.accounts, 0); // "last"
  const machine: Machine = storing();
  const exit: HostExit = checkpoint(machine, a);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], 10_000n - 103n); // the gas left, after paying 103
  write(storing(0x20001n, 3n, 0x20010n, 3n), a.accounts, 0); // "ast", after the checkpoint
  const afterPanic: Map<number, Account> = collapse(a, "panic");
  const keys: string[] = [...afterPanic.get(0)!.storage.keys()];
  assert.deepEqual(keys, ["0x6c617374"]);
});

test("accumulate, Ψ_A: service 1729 halts on 16,417 gas, its accounts kept", () => {
  const { a, slot, expected } = vectorAccumulation();
  const { exit, accounts, gasUsed }: Accumulated = accumulate(TINY, a, slot, 100_000n);
  assert.deepEqual([exit, gasUsed], ["halt", expected]);
  assert.equal(accounts, a.accounts); // the halt kept what it did (nothing, this time)
});

/** A machine about to look up `data` by its hash, which sits in memory at 0x20000. */
function lookingUp(who: bigint, data: Uint8Array) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  writeMemory(memory, 0x20000n, blake2b256(data));
  const registers = [0n, 0n, 0n, 0n, 0n, 0n, 0n, who, 0x20000n, 0x20100n, 0n, 100n];
  return newMachine(assemble([[0]]), registers, memory, 10_000n);
}

test("lookup: a preimage the service keeps, found by its hash", () => {
  const data: Bytes = new TextEncoder().encode("hello, JAM");
  const accounts: Map<number, Account> = tinyAccounts();
  accounts.get(0)!.preimages.set(toHex(blake2b256(data)), data);
  const machine: Machine = lookingUp(2n ** 64n - 1n, data);
  const exit: HostExit = lookup(machine, accounts, 0);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], 10n);
  const found: Bytes | MemoryError = readMemory(machine.memory, 0x20100n, 10);
  assert.deepEqual(found, data);
  assert.equal(machine.gas, 10_000n - 600n - 25n); // and 248 per KiB of the 100 bytes asked for
});

test("lookup of a hash the service doesn't keep, or of a service that isn't there: NONE", () => {
  const data: Bytes = new TextEncoder().encode("nobody provided this");
  const missing: Machine = lookingUp(2n ** 64n - 1n, data);
  lookup(missing, tinyAccounts(), 0);
  assert.equal(missing.registers[7], NONE);
  const nobody: Machine = lookingUp(42n, data);
  lookup(nobody, tinyAccounts(), 0);
  assert.equal(nobody.registers[7], NONE);
});

const HASH = new Uint8Array(32).fill(5);

/** A machine about to make a request: φ₇ points at a hash of fives, φ₈ = the length. */
function requesting(length: bigint) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  writeMemory(memory, 0x20000n, HASH);
  const registers = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0x20000n, length];
  return newMachine(assemble([[0]]), registers, memory, 10_000n);
}

test("solicit: a request with no slots yet, and 2 items and 81 + 100 bytes more to pay for", () => {
  const a: Accumulation = bundle();
  const machine: Machine = requesting(100n);
  const exit: HostExit = solicit(machine, a, 7);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], OK);
  const account: Account = a.accounts.get(0)!;
  const request: number[] | undefined = account.requests.get(`${toHex(HASH)}:100`);
  assert.deepEqual(request, []);
  assert.deepEqual([account.info.items, account.info.bytes], [4, 50n + 81n + 100n]);
  const asking: Machine = requesting(100n);
  query(asking, a);
  const slots: bigint[] = asking.registers.slice(7, 9); // asked for, no slots yet
  assert.deepEqual(slots, [0n, 0n]);
});

test("asking twice is HUH, and so is a length no preimage can have", () => {
  const a: Accumulation = bundle();
  solicit(requesting(100n), a, 7);
  const again: Machine = requesting(100n);
  solicit(again, a, 8);
  assert.equal(again.registers[7], HUH);
  const huge: Machine = requesting(2n ** 32n);
  solicit(huge, a, 8);
  assert.equal(huge.registers[7], HUH);
});

test("forget: a request never provided just goes; one provided at x becomes [x, t]", () => {
  const a: Accumulation = bundle();
  solicit(requesting(100n), a, 7);
  forget(requesting(100n), a, 9, TINY.expunge_period);
  assert.equal(a.accounts.get(0)!.requests.size, 0);
  a.accounts.get(0)!.requests.set(`${toHex(HASH)}:100`, [3]); // provided at slot 3
  forget(requesting(100n), a, 9, TINY.expunge_period);
  const asking: Machine = requesting(100n);
  query(asking, a);
  const slots: bigint[] = asking.registers.slice(7, 9); // 2 slots: 3, 9
  assert.deepEqual(slots, [2n + 3n * 2n ** 32n, 9n]);
});

/** A machine about to send `amount` to service `dest` with `gas`, and the memo "gift". */
function sending(dest: bigint, amount: bigint, gas: bigint) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  writeMemory(memory, 0x20000n, new TextEncoder().encode("gift"));
  const registers = [0n, 0n, 0n, 0n, 0n, 0n, 0n, dest, amount, gas, 0x20000n];
  return newMachine(assemble([[0]]), registers, memory, 10_000n);
}

test("transfer: the money leaves at once, and a checkpoint keeps what was sent", () => {
  const a: Accumulation = bundle();
  a.accounts.set(1, copyAccounts(a.accounts).get(0)!); // a second service, to send to
  const outbox: Outbox = { transfers: [], kept: [] };
  const machine: Machine = sending(1n, 30n, 25n); // 30 to service 1, with 25 gas for it
  const exit: HostExit = transfer(machine, a, outbox);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], OK);
  assert.equal(machine.gas, 10_000n - 575n - 25n); // the call, and the transfer's gas
  assert.equal(a.accounts.get(0)!.info.balance, 970n); // gone from the sender now
  assert.equal(a.accounts.get(1)!.info.balance, 1000n); // not there yet: next round
  checkpoint(storing(), a, outbox); // the first transfer is kept now
  transfer(sending(1n, 40n, 25n), a, outbox); // and a second one, after the checkpoint
  const afterHalt: Transfer[] = collapseTransfers(outbox, "halt"); // a halt sends both
  assert.equal(afterHalt.length, 2);
  const afterPanic: Transfer[] = collapseTransfers(outbox, "panic"); // only the kept one
  assert.equal(afterPanic.length, 1);
});

test("transfer refuses: no such service, too little gas, too little money", () => {
  const a: Accumulation = bundle();
  const outbox: Outbox = { transfers: [], kept: [] };
  const answer = (machine: ReturnType<typeof sending>) => {
    transfer(machine, a, outbox);
    return machine.registers[7];
  };
  const toNobody: bigint = answer(sending(5n, 30n, 25n)); // there's no service 5
  assert.equal(toNobody, WHO);
  const tooLittleGas: bigint = answer(sending(0n, 30n, 10n)); // service 0 wants at least 20 gas
  assert.equal(tooLittleGas, LOW);
  const tooLittleMoney: bigint = answer(sending(0n, 900n, 25n)); // 1000 − 900 is below its 170
  assert.equal(tooLittleMoney, CASH);
  assert.deepEqual(outbox.transfers, []); // nothing was sent
});

/** Service 0 holds every privilege, on both of tiny's cores. */
const ZERO_HOLDS_ALL: Privileges = { bless: 0, assign: [0, 0], designate: 0, register: 0 };

/** A machine about to assign core `c` to service `to`, with a queue of 80 hashes of 7s. */
function assigning(c: bigint, to: bigint) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  writeMemory(memory, 0x20000n, new Uint8Array(80 * 32).fill(7));
  const registers = [0n, 0n, 0n, 0n, 0n, 0n, 0n, c, 0x20000n, to];
  return newMachine(assemble([[0]]), registers, memory, 10_000n);
}

test("assign: the assigner hands a core on, and a checkpoint keeps the change", () => {
  const powers: Powers = startPowers(ZERO_HOLDS_ALL);
  const machine: Machine = assigning(0n, 1n); // core 0, to service 1
  const exit: HostExit = assign(machine, 0, powers, 2);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], OK);
  assert.equal(machine.gas, 10_000n - 1818n);
  assert.deepEqual(powers.now.privileges.assign, [1, 0]); // core 0 is service 1's now
  const lastInQueue: Bytes = powers.now.queues.get(0)![79]; // its new queue
  assert.deepEqual(lastInQueue, new Uint8Array(32).fill(7));
  const undone: Privileged = collapsePowers(powers, "panic");
  assert.deepEqual(undone.privileges.assign, [0, 0]);
  checkpoint(storing(), bundle(), { transfers: [], kept: [] }, powers);
  const kept: Privileged = collapsePowers(powers, "panic");
  assert.deepEqual(kept.privileges.assign, [1, 0]);
});

test("assign refuses: no such core, not the core's assigner, not a service id", () => {
  const powers: Powers = startPowers(ZERO_HOLDS_ALL);
  const answer = (machine: ReturnType<typeof assigning>, s: number) => {
    assign(machine, s, powers, 2);
    return machine.registers[7];
  };
  const noSuchCore: bigint = answer(assigning(2n, 1n), 0); // tiny has cores 0 and 1
  assert.equal(noSuchCore, CORE);
  const notTheAssigner: bigint = answer(assigning(0n, 1n), 5); // service 5 isn't core 0's
  assert.equal(notTheAssigner, HUH);
  const noSuchService: bigint = answer(assigning(0n, 2n ** 32n), 0); // no service has that id
  assert.equal(noSuchService, WHO);
  assert.deepEqual(powers.now.privileges.assign, [0, 0]); // nothing changed
});

/**
 * Service 0, and service 1 ready to be ejected by it: its code hash names service 0, and
 * its one request, for HASH, was forgotten at slot 10.
 */
function ejectable() {
  const a = bundle();
  const zombie = copyAccounts(a.accounts).get(0)!;
  zombie.info = { ...zombie.info, code_hash: new Uint8Array(32), items: 2, bytes: 81n + 20n };
  zombie.requests = new Map([[`${toHex(HASH)}:20`, [5, 10]]]); // provided at 5, forgotten at 10
  a.accounts.set(1, zombie);
  return a;
}

/** A machine about to eject service `d`, naming the preimage HASH. */
function ejecting(d: bigint) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  writeMemory(memory, 0x20000n, HASH);
  return newMachine(assemble([[0]]), [0n, 0n, 0n, 0n, 0n, 0n, 0n, d, 0x20000n], memory, 10_000n);
}

test("eject: a service that named its ejector goes, and its balance goes to the ejector", () => {
  const a: Accumulation = ejectable();
  const machine: Machine = ejecting(1n);
  const exit: HostExit = eject(machine, a, 100, TINY.expunge_period);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], OK);
  assert.equal(machine.gas, 10_000n - 458n);
  assert.equal(a.accounts.has(1), false); // gone
  assert.equal(a.accounts.get(0)!.info.balance, 2000n); // its 1000 and the other's 1000
  const again: Machine = ejecting(1n);
  eject(again, a, 100, TINY.expunge_period);
  assert.equal(again.registers[7], WHO); // gone means gone: no second helping
  assert.equal(a.accounts.get(0)!.info.balance, 2000n);
});

test("eject refuses: itself, a stranger, or a preimage forgotten too recently", () => {
  const answer = (d: bigint, t: number) => {
    const machine = ejecting(d);
    eject(machine, ejectable(), t, TINY.expunge_period);
    return machine.registers[7];
  };
  const itself: bigint = answer(0n, 100); // a service can't eject itself
  assert.equal(itself, WHO);
  const stranger: bigint = answer(5n, 100); // there's no service 5
  assert.equal(stranger, WHO);
  const tooRecent: bigint = answer(1n, 10 + TINY.expunge_period); // forgotten at 10: too soon
  assert.equal(tooRecent, HUH);
});

/** A machine about to create a service: code HASH, `length` bytes, `gratis`, id `wanted`. */
function creating(length: bigint, gratis = 0n, wanted = 0n) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  writeMemory(memory, 0x20000n, HASH);
  const registers = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0x20000n, length, 10n, 10n, gratis, wanted];
  return newMachine(assemble([[0]]), registers, memory, 10_000n);
}

test("new: a service pays for another, which gets the next id, or the registrar's choice", () => {
  const a: Accumulation = bundle(); // service 0: 1000, of which 170 must stay
  const ids: NewIds = { next: 70_000, taken: new Set([0]) };
  const machine: Machine = creating(20n); // 20 bytes of code: 81 + 20 bytes, 2 items
  const exit: HostExit = newService(machine, a, 7, ids, NO_PRIVILEGES);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], 70_000n); // its id
  assert.equal(a.accounts.get(70_000)!.info.balance, 221n); // 100 + 2 × 10 + 101
  assert.equal(a.accounts.get(0)!.info.balance, 1000n - 221n); // paid by service 0
  assert.equal(ids.next, 70_042); // the next one: 42 further on
  const registrar: Privileges = { ...NO_PRIVILEGES, register: 0 };
  const chosen: Machine = creating(20n, 0n, 5n); // service 0, the registrar, asks for id 5
  newService(chosen, a, 7, ids, registrar);
  assert.equal(chosen.registers[7], 5n);
  assert.equal(ids.next, 70_042); // a chosen id doesn't move the next one
});

test("new refuses: gratis from a non-manager, not enough money, a registrar's id taken", () => {
  const answer = (machine: ReturnType<typeof creating>, privileges = NO_PRIVILEGES) => {
    newService(machine, bundle(), 7, { next: 70_000, taken: new Set([0]) }, privileges);
    return machine.registers[7];
  };
  const gratis: bigint = answer(creating(20n, 5n)); // only the manager gives gratis storage
  assert.equal(gratis, HUH);
  const tooPoor: bigint = answer(creating(900n)); // 1101 for it would leave too little
  assert.equal(tooPoor, CASH);
  const taken: bigint = answer(creating(20n, 0n, 0n), { ...NO_PRIVILEGES, register: 0 });
  assert.equal(taken, FULL);
});

test("a run's first new id is public, and skips ids already taken", () => {
  const entropy: Bytes = new Uint8Array(32);
  const { next }: NewIds = newIds(0, entropy, 7, new Set());
  assert.ok(next >= 2 ** 16);
  const skipped: NewIds = newIds(0, entropy, 7, new Set([next])); // taken: one up
  assert.equal(skipped.next, next + 1);
});

/** A machine about to upgrade to the code hash HASH, at o, with least gases 123 and 456. */
function upgrading(o = 0x20000n) {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  writeMemory(memory, 0x20000n, HASH);
  return newMachine(assemble([[0]]), [0n, 0n, 0n, 0n, 0n, 0n, 0n, o, 123n, 456n], memory, 10_000n);
}

test("upgrade: new code and new least gases, for 1,028 gas", () => {
  const a: Accumulation = bundle();
  const machine: Machine = upgrading();
  const exit: HostExit = upgrade(machine, a);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], OK);
  const info: ServiceInfo = a.accounts.get(0)!.info;
  assert.deepEqual([info.code_hash, info.min_item_gas, info.min_memo_gas], [HASH, 123n, 456n]);
  const used: bigint = 10_000n - machine.gas;
  assert.equal(used, 1028n);
  const unreadable: HostExit = upgrade(upgrading(0n), bundle()); // nothing to read at 0
  assert.equal(unreadable, "panic");
});

test("yield: a hash for the chain; a halt's 32-byte output takes its place", () => {
  const outbox: Outbox = { transfers: [], kept: [] };
  const machine: Machine = upgrading(); // φ₇ points at HASH, as yield wants
  const exit: HostExit = yieldHash(machine, outbox);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], OK);
  const halted: Bytes | undefined = collapseYield(outbox, "halt");
  assert.deepEqual(halted, HASH);
  const output: Bytes = new Uint8Array(32).fill(1);
  const fromOutput: Bytes | undefined = collapseYield(outbox, "halt", output);
  assert.deepEqual(fromOutput, output);
  const panicked: Bytes | undefined = collapseYield(outbox, "panic"); // nothing checkpointed
  assert.equal(panicked, undefined);
});

test("provide: a preimage for a service that asked for it, once", () => {
  const a: Accumulation = bundle(); // service 0
  const wanted: Bytes = Uint8Array.of(1, 2, 3); // storing's bytes at 0x20010
  a.accounts.get(0)!.requests.set(`${toHex(blake2b256(wanted))}:3`, []); // asked, waiting
  const outbox: Outbox = { transfers: [], kept: [] };
  const toItself: Machine = storing(2n ** 64n - 1n, 0x20010n, 3n); // 2^64 − 1: this service
  provide(toItself, a, outbox);
  assert.equal(toItself.registers[7], OK);
  assert.deepEqual(outbox.provided, [{ service: 0, preimage: wanted }]);
  const answer = (w: bigint, b = a) => {
    const machine = storing(w, 0x20010n, 3n);
    provide(machine, b, outbox);
    return machine.registers[7];
  };
  const twice: bigint = answer(0n); // this run provided it already
  assert.equal(twice, HUH);
  const noSuchService: bigint = answer(7n);
  assert.equal(noSuchService, WHO);
  const notAsked: bigint = answer(0n, bundle()); // a service 0 that never asked
  assert.equal(notAsked, HUH);
});

/** A machine about to bless: manager 1, the assigners 2 and 3 (at 0x20000), delegator 4,
 * registrar 5, and one always-accumulate service, 6 with 1,000 gas (at 0x20010). */
function blessing() {
  const memory = new Map();
  addPages(memory, 0x20000, 4096, "W");
  writeMemory(memory, 0x20000n, Uint8Array.of(2, 0, 0, 0, 3, 0, 0, 0));
  writeMemory(memory, 0x20010n, Uint8Array.of(6, 0, 0, 0, 0xe8, 3, 0, 0, 0, 0, 0, 0));
  const registers = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, 0x20000n, 4n, 5n, 0x20010n, 1n];
  return newMachine(assemble([[0]]), registers, memory, 10_000n);
}

test("bless: every privilege at once, and the always-accumulate services", () => {
  const powers: Powers = startPowers(ZERO_HOLDS_ALL);
  const machine: Machine = blessing();
  const exit: HostExit = bless(machine, powers, 2);
  assert.equal(exit, "continue");
  assert.equal(machine.registers[7], OK);
  const privileges: Privileges = powers.now.privileges;
  assert.deepEqual(privileges, { bless: 1, assign: [2, 3], designate: 4, register: 5 });
  const free: Map<number, bigint> | undefined = powers.now.free;
  assert.deepEqual(free, new Map([[6, 1000n]]));
  const used: bigint = 10_000n - machine.gas; // 422, and 20 for the one entry
  assert.equal(used, 442n);
});

/** A machine about to designate `z` validators, whose keys are all 7s (at 0x20000). */
function designating(z: bigint) {
  const memory = new Map();
  addPages(memory, 0x20000, 3 * 4096, "W");
  writeMemory(memory, 0x20000n, new Uint8Array(336 * 6).fill(7));
  return newMachine(assemble([[0]]), [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0x20000n, z], memory, 10_000n);
}

test("designate: the delegator picks the next validators; a count tiny can't have, HUH", () => {
  const powers: Powers = startPowers(ZERO_HOLDS_ALL); // service 0 is the delegator
  const six: Machine = designating(6n); // tiny's 2 cores allow exactly 6
  designate(six, 0, powers, 2);
  assert.equal(six.registers[7], OK);
  const staging: Bytes[] = powers.now.staging!;
  assert.deepEqual([staging.length, staging[5].length], [6, 336]);
  const three: Machine = designating(3n); // fewer than 6
  designate(three, 0, powers, 2);
  assert.equal(three.registers[7], HUH);
  const notTheDelegator: Machine = designating(6n);
  designate(notTheDelegator, 1, powers, 2);
  assert.equal(notTheDelegator.registers[7], HUH);
});
