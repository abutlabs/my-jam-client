// Host calls (GP App. A.6 and B): when a program says ecalli, the machine stops, the host
// answers (in registers, memory and gas), and the machine carries on after the ecalli.

import type { Exit, Machine } from "./pvm/machine.ts";
import { runWithGas } from "./pvm/gas.ts";
import { skip } from "./pvm/instructions.ts";
import type { Bytes } from "./bytes.ts";
import { concatBytes, toHex } from "./bytes.ts";
import { encodeFixed, encodeNatural, decodeFixed } from "./codec/numbers.ts";
import type { Config } from "./config.ts";
import { writeMemory, addPages, PAGE_SIZE, readMemory } from "./pvm/memory.ts";
import type { ServiceCode } from "./pvm/program.ts";
import { INPUT_SIZE, roundUp, ZONE, standardProgram } from "./pvm/standard.ts";
import type { Account } from "./services.ts";
import { minimumBalance, copyAccounts, storageValue, setStorageValue, preimageOf, setPreimage, requestOf, setRequest } from "./services.ts";
import { newMachine } from "./pvm/machine.ts";
import { deblob } from "./pvm/program.ts";
import type { Value } from "./codec/codec.ts";
import { fixedBytes, record, u32, u64 } from "./codec/codec.ts";
import { QUEUE_SIZE } from "./authorization.ts";
import { blake2b256 } from "./hash.ts";

/** The answers a host call can give in φ₇ when it can't do what was asked (GP App. B.1). */
export const NONE = 2n ** 64n - 1n; // no such item
export const WHAT = 2n ** 64n - 2n; // no such host call
export const OK = 0n;

/** The host calls, by number (GP App. B.5 and B.7): gas is 0, fetch is 2, provide 27. */
export const HOST_CALLS = [
  "gas", "grow_heap", "fetch", "lookup", "read", "write", "info", "historical_lookup",
  "export", "machine", "peek", "poke", "pages", "invoke", "expunge", "bless", "assign",
  "designate", "checkpoint", "new", "upgrade", "transfer", "eject", "query", "solicit",
  "forget", "yield", "provide",
];

/** How a host call ends: carry on, or stop the machine for good. */
export type HostExit = "continue" | "halt" | "panic" | "oog";

/** A host: answers host call number `call` by changing the machine. */
export type Host = (call: number, m: Machine) => HostExit;

/**
 * Ψ_H (GP App. A.6): runs the machine, and every time it calls the host, lets the host
 * answer and carries on after the ecalli. Stops when the machine or the host says so.
 */
export function runWithHost(m: Machine, host: Host): Exit {
  for (;;) {
    const exit = runWithGas(m);
    if (typeof exit !== "object" || !("host" in exit)) return exit;
    const answer = host(exit.host, m);
    if (answer !== "continue") return answer;
    m.pc += 1 + skip(m.program, m.pc); // ı″ = ı′ + 1 + skip(ı′): the one after the ecalli
  }
}

/** Every host call costs gas: g is taken first, and if that leaves too little, oog. */
export function charge(m: Machine, g: number | bigint): boolean {
  m.gas -= BigInt(g);
  return m.gas >= 0n;
}

/** gas (GP App. B.5, Ω_G): φ₇ = the gas left, after paying 48 to ask. */
export function gas(m: Machine): HostExit {
  if (!charge(m, 48)) return "oog";
  m.registers[7] = m.gas;
  return "continue";
}

/** A host call nobody knows (GP App. B.4, the end of F): φ₇ = WHAT, for 1,000 gas. */
export function unknown(m: Machine): HostExit {
  m.registers[7] = WHAT;
  return charge(m, 1000) ? "continue" : "oog";
}

/** 𝔐(L, ℓ) (GP App. B.5): gas for ℓ bytes, at L gas per 1,024 of them, rounded up. */
const memoryGas = (rate: number, length: bigint) => (BigInt(rate) * length + 1023n) / 1024n;

/** Fetch's item 0 (GP App. B.5): the protocol's constants, 29 of them in 122 bytes. */
export function protocolConstants(config: Config): Bytes {
  const fields: [number, number | bigint][] = [
    [8, 10], [8, 1], [8, 100], // B_I, B_L, B_S: deposits per item, per byte, per service
    [2, config.core_count], [4, config.expunge_period], [4, config.epoch_length], // C, D, E
    [8, 10_000_000], [8, 50_000_000], [8, config.max_refine_gas], [8, config.max_block_gas],
    [2, 8], [2, 16], [2, 8], [2, config.max_tickets_per_extrinsic], // H, I, J, K
    [4, config.max_lookup_anchor_age], [2, 8], [2, 6], [2, 80], [2, config.rotation_period],
    [2, 128], [2, 5], [4, 64_000], [4, 13_791_360], [4, 4_000_000], [4, 3072], // T to W_M
    [4, 48 * 1024], [4, 128], [4, 3072], [4, config.epoch_tail_start], // W_R, W_T, W_X, Y
  ];
  return concatBytes(...fields.map(([n, v]) => encodeFixed(BigInt(v), n)));
}

/** Fetch's gas (GP App. B.5): a base and a rate per 1,024 bytes asked for, item by item. */
const FETCH_GAS: [number, number][] = [
  [390, 0], [103, 0], [80, 96], [85, 96], [85, 96], [171, 0], [171, 0], [85, 96],
  [84, 0], [88, 0], [111, 0], [317, 0], [250, 0], [95, 96], [287, 400], [355, 344],
  [80, 0], // any other item: nothing there
];

/** What an invocation lets fetch hand out: item `kind` (and `index`), or nothing. */
export type Items = (kind: number, index: bigint) => Bytes | undefined;

/**
 * fetch (GP App. B.5, Ω_Y): copies item φ₁₀ (with index φ₁₁) to memory at φ₇: up to φ₉
 * bytes of it, from byte φ₈ on. φ₇ becomes the item's whole length, or NONE if there's no
 * such item. `find` says what each item is, so each invocation offers its own.
 */
export function fetch(m: Machine, find: Items): HostExit {
  const [o, from, length, kind, index] = m.registers.slice(7, 12);
  const [base, rate] = FETCH_GAS[kind < 16n ? Number(kind) : 16];
  if (!charge(m, BigInt(base) + memoryGas(rate, length))) return "oog";
  return copyOut(m, kind < 16n ? find(Number(kind), index) : undefined, o, from, length);
}

/**
 * F (GP App. B.4): the host for a service's accumulation. So far it answers gas, grow_heap,
 * fetch (whose items are the constants, 0; the entropy, 1; and the inputs, all of them, 14,
 * or one, 15), info, lookup, read, write, checkpoint, query, solicit and forget, the last
 * two at `slot`, the time of the block; transfer, into `outbox`; assign, with `powers`;
 * eject; new; upgrade; yield and provide, into `outbox` too; and bless and designate, with
 * `powers`. Anything else: WHAT.
 */
export function accumulateHost(
  config: Config,
  a: Accumulation,
  slot: number,
  outbox: Outbox = { transfers: [], kept: [] },
  powers: Powers = startPowers(),
): Host {
  const ids = newIds(a.id, a.entropy, slot, new Set(a.accounts.keys())); // for `new`
  const items: Items = (kind, index) => {
    if (kind === 0) return protocolConstants(config);
    if (kind === 1) return a.entropy;
    if (kind === 14) return concatBytes(encodeNatural(BigInt(a.inputs.length)), ...a.inputs);
    if (kind === 15 && index < BigInt(a.inputs.length)) return a.inputs[Number(index)];
    return undefined;
  };
  return (call, m) => {
    switch (HOST_CALLS[call]) {
      case "gas":
        return gas(m);
      case "grow_heap":
        return growHeap(m, a.code);
      case "fetch":
        return fetch(m, items);
      case "info":
        return info(m, a.accounts, a.id);
      case "lookup":
        return lookup(m, a.accounts, a.id);
      case "read":
        return read(m, a.accounts, a.id);
      case "write":
        return write(m, a.accounts, a.id);
      case "checkpoint":
        return checkpoint(m, a, outbox, powers);
      case "query":
        return query(m, a);
      case "solicit":
        return solicit(m, a, slot);
      case "forget":
        return forget(m, a, slot, config.expunge_period);
      case "transfer":
        return transfer(m, a, outbox);
      case "assign":
        return assign(m, a.id, powers, config.core_count);
      case "eject":
        return eject(m, a, slot, config.expunge_period);
      case "new":
        return newService(m, a, slot, ids, powers.now.privileges);
      case "upgrade":
        return upgrade(m, a);
      case "yield":
        return yieldHash(m, outbox);
      case "provide":
        return provide(m, a, outbox);
      case "bless":
        return bless(m, powers, config.core_count);
      case "designate":
        return designate(m, a.id, powers, config.core_count);
      default:
        return unknown(m);
    }
  };
}

/**
 * grow_heap (GP App. B.5, Ω_Gemini): makes the read-write zone's pages writable up to page
 * φ₇ (not including it), and says where the heap ends now. The zone starts at page a, may
 * reach b, and ends at h today. Asking for no more than h, or past b, just reports h.
 */
export function growHeap(m: Machine, code: ServiceCode): HostExit {
  const a = (2 * ZONE + roundUp(code.readOnly.length, ZONE)) / PAGE_SIZE;
  const b = (2 ** 32 - 3 * ZONE - INPUT_SIZE - roundUp(code.stackSize, PAGE_SIZE)) / PAGE_SIZE;
  const writable = [...m.memory].filter(([p, page]) => p >= a && p < b && page.access === "W");
  const h = a + writable.length;
  const want = m.registers[7];
  if (want <= BigInt(h) || want > BigInt(b)) {
    m.registers[7] = BigInt(h);
    return charge(m, 275) ? "continue" : "oog";
  }
  const g = 275n + (want - BigInt(h)) * 121n; // and 121 for each new page
  m.registers[7] = BigInt(h);
  if (!charge(m, g)) return "oog"; // all the gas is gone, as for any host call (19.6)
  addPages(m.memory, h * PAGE_SIZE, (Number(want) - h) * PAGE_SIZE, "W");
  m.registers[7] = want;
  return "continue";
}

/**
 * How fetch, info, read and lookup answer (GP App. B.5): `length` bytes of v at most, from
 * byte `from`, go to memory at o, and φ₇ = |v|. No v: NONE. Nowhere to write it: panic.
 */
function copyOut(m: Machine, v: Bytes | undefined, o: bigint, from: bigint, length: bigint) {
  if (v === undefined) {
    m.registers[7] = NONE;
    return "continue";
  }
  const f = from < BigInt(v.length) ? Number(from) : v.length;
  const l = length < BigInt(v.length - f) ? Number(length) : v.length - f;
  if (writeMemory(m.memory, o, v.subarray(f, f + l))) return "panic"; // not writable
  m.registers[7] = BigInt(v.length);
  return "continue";
}

/** info (GP App. B.5, Ω_I): service φ₇'s record (its own if φ₇ = 2^64 − 1), 96 bytes. */
export function info(m: Machine, accounts: Map<number, Account>, s: number): HostExit {
  if (!charge(m, 703)) return "oog";
  const [who, o, from, length] = m.registers.slice(7, 11);
  const a = accounts.get(who === 2n ** 64n - 1n ? s : Number(who))?.info;
  const v = a && concatBytes(
    a.code_hash,
    ...[a.balance, minimumBalance(a), a.min_item_gas, a.min_memo_gas, a.bytes].map((x) =>
      encodeFixed(x, 8),
    ),
    encodeFixed(BigInt(a.items), 4),
    encodeFixed(a.deposit_offset, 8),
    ...[a.creation_slot, a.last_accumulation_slot, a.parent_service].map((x) =>
      encodeFixed(BigInt(x), 4),
    ),
  );
  return copyOut(m, v, o, from, length);
}

/**
 * What a service's accumulation runs with (GP App. B.4): which service it is, the accounts
 * twice over (as it changes them, and as they'll be if it fails), its code, the entropy
 * η′₀, and its inputs, each one encoded.
 */
export type Accumulation = {
  id: number;
  accounts: Map<number, Account>; // as the service changes them (the GP's X)
  checkpoint: Map<number, Account>; // as they were at the last checkpoint (Y)
  code: ServiceCode;
  entropy: Bytes;
  inputs: Bytes[];
  privileges?: Privileges; // χ as the run starts (lesson 17.5); nobody's, if left out
};

export const FULL = 2n ** 64n - 5n; // not enough balance to keep that much

/**
 * read (GP App. B.5, Ω_R): from the storage of service φ₇ (its own if φ₇ = 2^64 − 1), the
 * value under the key in memory at φ₈ (φ₉ bytes long), copied out like fetch from φ₁₀ on.
 */
export function read(m: Machine, accounts: Map<number, Account>, s: number): HostExit {
  const [who, keyAt, keyLength, o, from, length] = m.registers.slice(7, 13);
  if (!charge(m, 2407n + memoryGas(1736, keyLength) + memoryGas(248, length))) return "oog";
  const key = readMemory(m.memory, keyAt, Number(keyLength));
  if (!(key instanceof Uint8Array)) return "panic"; // the key isn't readable
  const owner = who === 2n ** 64n - 1n ? s : Number(who);
  const account = accounts.get(owner);
  return copyOut(m, account && storageValue(account, owner, key), o, from, length);
}

/**
 * write (GP App. B.5, Ω_W): stores the value at φ₉ (φ₁₀ bytes) under the key at φ₇ (φ₈
 * bytes), or deletes the key if the value is empty. φ₇ = the old value's length, or NONE.
 * If the service's balance can't cover its new footprint, nothing changes: FULL.
 */
export function write(m: Machine, accounts: Map<number, Account>, s: number): HostExit {
  const [keyAt, keyLength, valueAt, valueLength] = m.registers.slice(7, 11);
  if (!charge(m, 2442n + memoryGas(3358, keyLength) + memoryGas(216, valueLength))) return "oog";
  const key = readMemory(m.memory, keyAt, Number(keyLength));
  const value = valueLength === 0n ? undefined : readMemory(m.memory, valueAt, Number(valueLength));
  if (!(key instanceof Uint8Array) || !(value === undefined || value instanceof Uint8Array)) {
    return "panic"; // the key or the value isn't readable
  }
  const account = accounts.get(s)!;
  const old = storageValue(account, s, key);
  const size = (v: Bytes | undefined) => (v ? 34n + BigInt(key.length + v.length) : 0n);
  const after = {
    ...account.info,
    items: account.info.items + (value ? 1 : 0) - (old ? 1 : 0),
    bytes: account.info.bytes + size(value) - size(old), // lesson 14.2's footprint
  };
  if (minimumBalance(after) > after.balance) {
    m.registers[7] = FULL;
    return "continue";
  }
  setStorageValue(account, s, key, value);
  account.info = after;
  m.registers[7] = old ? BigInt(old.length) : NONE;
  return "continue";
}

/** checkpoint (GP App. B.7, Ω_C): what the service has done so far is kept if it fails later. */
export function checkpoint(
  m: Machine,
  a: Accumulation,
  outbox: Outbox = { transfers: [], kept: [] },
  powers: Powers = startPowers(),
): HostExit {
  if (!charge(m, 103)) return "oog";
  a.checkpoint = copyAccounts(a.accounts); // Y′ = X
  outbox.kept = [...outbox.transfers]; // the transfers sent so far, too
  outbox.keptYield = outbox.yielded; // and the yield
  outbox.keptProvided = [...(outbox.provided ?? [])]; // and the preimages provided
  powers.kept = copyPrivileged(powers.now); // and the privileges
  m.registers[7] = m.gas;
  return "continue";
}

/** C (GP App. B.4), so far: a halt keeps the accounts; anything else, the last checkpoint. */
export function collapse(a: Accumulation, exit: Exit): Map<number, Account> {
  return exit === "halt" ? a.accounts : a.checkpoint;
}

/** What an accumulation leaves: how it ended, the accounts after it, the gas it used, the
 * transfers it sent, the privileges as it left them, the hash it yielded, if any, and the
 * preimages it provided. */
export type Accumulated = {
  exit: Exit;
  accounts: Map<number, Account>;
  gasUsed: bigint;
  transfers: Transfer[];
  privileged: Privileged;
  yielded?: Bytes;
  provided: Provision[];
};

/**
 * Ψ_A (GP App. B.4), so far: runs service a.id's accumulation at `slot` on `gas`, through
 * accumulation's host, and collapses what it did, the transfers it sent and the privileges
 * included. `watch`, if given, sees each host call.
 */
export function accumulate(
  config: Config,
  a: Accumulation,
  slot: number,
  gas: bigint,
  watch?: (call: number, m: Machine) => void,
): Accumulated {
  const [t, s, n] = [slot, a.id, a.inputs.length].map((x) => encodeNatural(BigInt(x)));
  const { memory, registers } = standardProgram(a.code, concatBytes(t, s, n)); // Ψ_M's Y
  const machine = newMachine(deblob(a.code.program), registers, memory, gas);
  machine.pc = 5; // accumulation's way in
  const outbox: Outbox = { transfers: [], kept: [] }; // every run starts with none sent
  const powers = startPowers(a.privileges);
  const host = accumulateHost(config, a, slot, outbox, powers);
  const exit = runWithHost(machine, (call, m) => {
    const answer = host(call, m);
    watch?.(call, m);
    return answer;
  });
  const gasUsed = gas - (machine.gas > 0n ? machine.gas : 0n); // u = g − max(ϱ′, 0)
  const accounts = collapse(a, exit);
  const transfers = collapseTransfers(outbox, exit);
  const [o, length] = machine.registers.slice(7, 9); // a halt's output: `length` bytes at o
  const output = exit === "halt" && length === 32n ? readMemory(machine.memory, o, 32) : null;
  const yielded = collapseYield(outbox, exit, output instanceof Uint8Array ? output : undefined);
  const privileged = collapsePowers(powers, exit);
  const provided = collapseProvided(outbox, exit);
  return { exit, accounts, gasUsed, transfers, privileged, yielded, provided };
}

/**
 * lookup (GP App. B.5, Ω_L): the preimage of the hash in memory at φ₈, among those service
 * φ₇ keeps (its own if φ₇ is its id or 2^64 − 1), copied out like fetch to φ₉, from byte
 * φ₁₀, at most φ₁₁ bytes. NONE if the service doesn't have it.
 */
export function lookup(m: Machine, accounts: Map<number, Account>, s: number): HostExit {
  const [who, hashAt, o, from, length] = m.registers.slice(7, 12);
  if (!charge(m, 600n + memoryGas(248, length))) return "oog";
  const hash = readMemory(m.memory, hashAt, 32);
  if (!(hash instanceof Uint8Array)) return "panic"; // the hash isn't readable
  const owner = who === 2n ** 64n - 1n ? s : Number(who);
  const account = accounts.get(owner);
  return copyOut(m, account && preimageOf(account, owner, toHex(hash)), o, from, length);
}

export const HUH = 2n ** 64n - 9n; // that can't be done now

/** The hash a request names, in memory at φ₇, in hex; none if it isn't readable. */
function requestedHash(m: Machine): string | undefined {
  const hash = readMemory(m.memory, m.registers[7], 32);
  return hash instanceof Uint8Array ? toHex(hash) : undefined;
}

/**
 * query (GP App. B.7, Ω_Q): what has become of the service's request for the preimage of
 * φ₇'s hash, φ₈ bytes long. The slots in its history come back packed into φ₇ and φ₈:
 * their count in φ₇'s low 32 bits, the first above it, the second and third in φ₈.
 */
export function query(m: Machine, a: Accumulation): HostExit {
  if (!charge(m, 643)) return "oog";
  const [length, hash] = [m.registers[8], requestedHash(m)];
  if (length >= 2n ** 32n) return setTo(m, HUH); // no preimage is that long
  if (!hash) return "panic"; // the hash isn't readable
  const slots = requestOf(a.accounts.get(a.id)!, a.id, hash, length);
  if (!slots) {
    [m.registers[7], m.registers[8]] = [NONE, 0n];
    return "continue";
  }
  const [x, y, z] = slots.map(BigInt);
  m.registers[7] = BigInt(slots.length) + (x ?? 0n) * 2n ** 32n;
  m.registers[8] = (y ?? 0n) + (z ?? 0n) * 2n ** 32n;
  return "continue";
}

/**
 * solicit (GP App. B.7, Ω_S): asks for the preimage of φ₇'s hash, φ₈ bytes long. A new
 * request starts with no slots; one already provided and since forgotten ([x, y]) is asked
 * for again at slot t. Anything else: HUH. A request costs deposit (lesson 14.2): FULL if
 * the balance can't cover it.
 */
export function solicit(m: Machine, a: Accumulation, t: number): HostExit {
  if (!charge(m, 2193)) return "oog";
  const [length, hash] = [m.registers[8], requestedHash(m)];
  if (length >= 2n ** 32n) return setTo(m, HUH);
  if (!hash) return "panic";
  const account = a.accounts.get(a.id)!;
  const slots = requestOf(account, a.id, hash, length);
  if (slots && slots.length !== 2) return setTo(m, HUH);
  const { items, bytes } = account.info;
  const added = { ...account.info, items: items + 2, bytes: bytes + 81n + length }; // 14.2
  const info = slots ? account.info : added;
  if (info.balance < minimumBalance(info)) return setTo(m, FULL);
  setRequest(account, a.id, hash, length, slots ? [...slots, t] : []);
  account.info = info;
  return setTo(m, OK);
}

/**
 * forget (GP App. B.7, Ω_F): gives up on the preimage of φ₇'s hash, φ₈ bytes long. A
 * request never provided, or provided and forgotten more than D slots ago, goes, preimage
 * and all. One provided at x is marked forgotten now, [x, t]; one asked for again after
 * that ([x, y, w], y long enough ago) becomes [w, t]. Anything else: HUH.
 */
export function forget(m: Machine, a: Accumulation, t: number, D: number): HostExit {
  if (!charge(m, 3250)) return "oog";
  const [length, hash] = [m.registers[8], requestedHash(m)];
  if (length >= 2n ** 32n) return setTo(m, HUH);
  if (!hash) return "panic";
  const account = a.accounts.get(a.id)!;
  const slots = requestOf(account, a.id, hash, length);
  const expired = (y: number) => y < t - D;
  if (slots?.length === 0 || (slots?.length === 2 && expired(slots[1]))) {
    setRequest(account, a.id, hash, length); // gone, and the preimage with it
    setPreimage(account, a.id, hash, undefined);
    const { items, bytes } = account.info;
    account.info = { ...account.info, items: items - 2, bytes: bytes - 81n - length };
  } else if (slots?.length === 1) {
    setRequest(account, a.id, hash, length, [slots[0], t]);
  } else if (slots?.length === 3 && expired(slots[1])) {
    setRequest(account, a.id, hash, length, [slots[2], t]);
  } else {
    return setTo(m, HUH);
  }
  return setTo(m, OK);
}

/** φ₇ = an answer, and carry on. */
function setTo(m: Machine, answer: bigint): HostExit {
  m.registers[7] = answer;
  return "continue";
}

/**
 * A deferred transfer (GP §12, X): `amount` of service `source`'s balance, on its way to
 * service `dest`, with a 128-byte memo and `gas` for the receiver to handle it with.
 */
export const Transfer = record({
  source: u32,
  dest: u32,
  amount: u64,
  memo: fixedBytes(128), // W_T
  gas: u64,
});
export type Transfer = Value<typeof Transfer>;

/** What an accumulation has sent (the GP's 𝐭, y and 𝐩, in X and Y): every transfer so
 * far, and the ones the last checkpoint keeps if the run fails; the same for its yield and
 * the preimages it has provided. */
export type Outbox = {
  transfers: Transfer[];
  kept: Transfer[];
  yielded?: Bytes;
  keptYield?: Bytes;
  provided?: Provision[];
  keptProvided?: Provision[];
};

/** C (GP App. B.4), for transfers: a halt sends them all; anything else, only those the
 * last checkpoint kept. */
export function collapseTransfers(outbox: Outbox, exit: Exit): Transfer[] {
  return exit === "halt" ? outbox.transfers : outbox.kept;
}

export const WHO = 2n ** 64n - 4n; // no such service
export const CASH = 2n ** 64n - 7n; // not enough balance
export const LOW = 2n ** 64n - 8n; // not enough gas

/**
 * transfer (GP App. B.7, Ω_T): sends φ₈ of the service's balance to service φ₇, with the
 * memo at φ₁₀ and φ₉ gas for the receiver to spend on it. The money leaves the sender now;
 * it arrives in the next round. Nothing is sent if there's no such service (WHO), the gas
 * is below the receiver's minimum (LOW), or the sender would drop below its own (CASH).
 * Costs 575, and the transfer's gas on top if it's sent.
 */
export function transfer(m: Machine, a: Accumulation, outbox: Outbox): HostExit {
  if (!charge(m, 575)) return "oog";
  const [dest, amount, gas, memoAt] = m.registers.slice(7, 11);
  const memo = readMemory(m.memory, memoAt, 128);
  if (!(memo instanceof Uint8Array)) return "panic"; // the memo isn't readable
  const sender = a.accounts.get(a.id)!;
  const receiver = a.accounts.get(Number(dest));
  if (!receiver) return setTo(m, WHO);
  if (gas < receiver.info.min_memo_gas) return setTo(m, LOW);
  const balance = sender.info.balance - amount;
  if (balance < minimumBalance(sender.info)) return setTo(m, CASH);
  if (!charge(m, gas)) return "oog";
  sender.info = { ...sender.info, balance };
  outbox.transfers.push({ source: a.id, dest: Number(dest), amount, memo, gas });
  return setTo(m, OK);
}

/**
 * χ (GP §9), under the test vectors' names: which services hold the privileges. The fifth
 * privilege, accumulating every block (χ_Z), is lesson 17.1's `free`.
 */
export type Privileges = {
  bless: number; // χ_M, the manager: may hand out the privileges themselves
  assign: number[]; // χ_A, one for each core: may set the core's authorizer queue
  designate: number; // χ_V, the delegator: may choose the next validators
  register: number; // χ_R, the registrar: may create services with small ids
};

/** No service has this id: the holder of a privilege nobody has been given. */
const NOBODY = 2 ** 32;

/** The privileges when nobody holds any: no manager, no assigners, and so on. */
export const NO_PRIVILEGES: Privileges = {
  bless: NOBODY, assign: [], designate: NOBODY, register: NOBODY,
};

/**
 * What a run's privileged calls change (part of the GP's ψ): the privileges, and the new
 * authorizer queue (80 hashes) of each core this run has set one for; the always-accumulate
 * services (χ_Z) and the next validators' keys (ι), once the run has set them.
 */
export type Privileged = {
  privileges: Privileges;
  queues: Map<number, Bytes[]>;
  free?: Map<number, bigint>;
  staging?: Bytes[];
};

/** A run's privileged state, the GP's X and Y: now, and as the last checkpoint kept it. */
export type Powers = { now: Privileged; kept: Privileged };

/** A copy of p that changes on its own. */
export function copyPrivileged(p: Privileged): Privileged {
  return {
    privileges: { ...p.privileges, assign: [...p.privileges.assign] },
    queues: new Map(p.queues),
    free: p.free && new Map(p.free),
    staging: p.staging && [...p.staging],
  };
}

/** A run's powers as it starts: the privileges it was given, and no new queues yet. */
export function startPowers(privileges = NO_PRIVILEGES): Powers {
  const start = { privileges, queues: new Map<number, Bytes[]>() };
  return { now: copyPrivileged(start), kept: copyPrivileged(start) };
}

/** C (GP App. B.4), for the privileges: a halt keeps the run's; anything else, the kept. */
export function collapsePowers(powers: Powers, exit: Exit): Privileged {
  return exit === "halt" ? powers.now : powers.kept;
}

export const CORE = 2n ** 64n - 6n; // no such core

/**
 * assign (GP App. B.7, Ω_A): hands core φ₇ on. The 80 hashes at φ₈ become its authorizer
 * queue, and service φ₉ the one that may assign it next. Only the core's assigner may
 * (HUH for anyone else); CORE if there's no such core, WHO if φ₉ can't be a service id.
 */
export function assign(m: Machine, s: number, powers: Powers, cores: number): HostExit {
  if (!charge(m, 1818)) return "oog";
  const [c, o, to] = m.registers.slice(7, 10);
  const hashes = readMemory(m.memory, o, 32 * QUEUE_SIZE);
  if (!(hashes instanceof Uint8Array)) return "panic"; // the queue isn't readable
  if (c >= BigInt(cores)) return setTo(m, CORE);
  const { privileges, queues } = powers.now;
  if (privileges.assign[Number(c)] !== s) return setTo(m, HUH);
  if (to >= 2n ** 32n) return setTo(m, WHO);
  const queue = Array.from({ length: QUEUE_SIZE }, (_, i) => hashes.slice(32 * i, 32 * i + 32));
  queues.set(Number(c), queue);
  privileges.assign[Number(c)] = Number(to);
  return setTo(m, OK);
}

/**
 * eject (GP App. B.7, Ω_J): removes service φ₇ and takes its balance, if this service may.
 * The other service must have named this one as its ejector (its code hash is this
 * service's id, in 32 bytes), hold nothing but one request, for the preimage at φ₈ (as
 * long as its footprint minus 81), and have forgotten that preimage more than D slots ago.
 * WHO if it doesn't exist or names someone else, HUH if it isn't ready; nothing changes.
 */
export function eject(m: Machine, a: Accumulation, t: number, D: number): HostExit {
  if (!charge(m, 458)) return "oog";
  const [d, o] = m.registers.slice(7, 9);
  const hash = readMemory(m.memory, o, 32);
  if (!(hash instanceof Uint8Array)) return "panic"; // the hash isn't readable
  const other = Number(d) === a.id ? undefined : a.accounts.get(Number(d));
  const ejector = toHex(encodeFixed(BigInt(a.id), 32)); // E₃₂(this service's id)
  if (!other || toHex(other.info.code_hash) !== ejector) return setTo(m, WHO);
  const length = (other.info.bytes > 81n ? other.info.bytes : 81n) - 81n; // l
  const slots = requestOf(other, Number(d), toHex(hash), length);
  if (other.info.items !== 2 || !slots) return setTo(m, HUH);
  if (slots.length !== 2 || slots[1] >= t - D) return setTo(m, HUH); // not forgotten long ago
  const self = a.accounts.get(a.id)!;
  self.info = { ...self.info, balance: self.info.balance + other.info.balance };
  a.accounts.delete(Number(d));
  return setTo(m, OK);
}

/** S: below this id, only the registrar may create services, and only by choosing the id. */
const MIN_PUBLIC_ID = 2 ** 16;

/** How many ids `new` hands out in turn: every id from S up, but the top 256. */
const PUBLIC_IDS = 2 ** 32 - MIN_PUBLIC_ID - 2 ** 8;

/** The ids a run hands out to new services (the GP's i), and the ids already taken. */
export type NewIds = { next: number; taken: Set<number> };

/** check (GP App. B.4): id i if nobody has it, else the next one up that's free. */
function check(i: number, taken: Set<number>): number {
  while (taken.has(i)) i = ((i - MIN_PUBLIC_ID + 1) % PUBLIC_IDS) + MIN_PUBLIC_ID;
  return i;
}

/**
 * The first id a run of service s may give a new service (GP App. B.4, I): from the hash
 * of s, η′₀ and the slot, so no service can guess it ahead of time.
 */
export function newIds(s: number, entropy: Bytes, slot: number, taken: Set<number>): NewIds {
  const seed = concatBytes(encodeNatural(BigInt(s)), entropy, encodeNatural(BigInt(slot)));
  const start = decodeFixed(blake2b256(seed).subarray(0, 4)); // its first 4 bytes, as ℰ₄
  return { next: check(Number(start % BigInt(PUBLIC_IDS)) + MIN_PUBLIC_ID, taken), taken };
}

/**
 * new (GP App. B.7, Ω_N): creates a service whose code is the preimage of the 32-byte hash
 * at φ₇, φ₈ bytes long, which it asks for; with least gases φ₉ (to accumulate) and φ₁₀ (per
 * memo), and φ₁₁ of gratis storage. Its balance is its own minimum, paid by this service.
 * Its id: φ₁₂ if this is the registrar asking for an id below S, otherwise the run's next
 * free id. φ₇ = the new id. HUH: gratis from anyone but the manager; CASH: this service
 * can't afford it; FULL: the registrar's id is taken.
 */
export function newService(
  m: Machine,
  a: Accumulation,
  t: number,
  ids: NewIds,
  privileges: Privileges,
): HostExit {
  if (!charge(m, 3855)) return "oog";
  const [o, length, minGas, memoGas, gratis, wanted] = m.registers.slice(7, 13);
  const codeHash = readMemory(m.memory, o, 32);
  if (!(codeHash instanceof Uint8Array) || length >= 2n ** 32n) return "panic";
  const info = {
    version: 0, code_hash: codeHash, balance: 0n, min_item_gas: minGas, min_memo_gas: memoGas,
    bytes: 81n + length, deposit_offset: gratis, items: 2, creation_slot: t,
    last_accumulation_slot: 0, parent_service: a.id,
  };
  info.balance = minimumBalance(info); // a_t: just enough to keep what it keeps
  const self = a.accounts.get(a.id)!;
  const left = self.info.balance - info.balance; // what this service has after paying
  if (gratis !== 0n && a.id !== privileges.bless) return setTo(m, HUH);
  if (left < minimumBalance(self.info)) return setTo(m, CASH);
  const chosen = a.id === privileges.register && wanted < BigInt(MIN_PUBLIC_ID);
  if (chosen && a.accounts.has(Number(wanted))) return setTo(m, FULL);
  const id = chosen ? Number(wanted) : ids.next;
  const made: Account = { info, storage: new Map(), preimages: new Map(), requests: new Map() };
  if (self.items) made.items = new Map(); // read from the state, so its new service is too
  setRequest(made, id, toHex(codeHash), length, []); // it asks for its own code
  a.accounts.set(id, made);
  self.info = { ...self.info, balance: left };
  if (!chosen) { // the next free id: 42 further on, round the public range
    ids.next = check(((id - MIN_PUBLIC_ID + 42) % PUBLIC_IDS) + MIN_PUBLIC_ID, ids.taken);
  }
  return setTo(m, BigInt(id));
}

/**
 * upgrade (GP App. B.7, Ω_U): this service's code becomes the preimage of the 32-byte hash
 * at φ₇, and its least gas per item and per memo φ₈ and φ₉. A service may always change its
 * own code: no privilege needed. An unreadable hash: panic.
 */
export function upgrade(m: Machine, a: Accumulation): HostExit {
  if (!charge(m, 1028)) return "oog";
  const [o, minGas, memoGas] = m.registers.slice(7, 10);
  const codeHash = readMemory(m.memory, o, 32);
  if (!(codeHash instanceof Uint8Array)) return "panic"; // the hash isn't readable
  const self = a.accounts.get(a.id)!;
  self.info = { ...self.info, code_hash: codeHash, min_item_gas: minGas, min_memo_gas: memoGas };
  return setTo(m, OK);
}

/**
 * yield (GP App. B.7, Ω_♉): the 32 bytes at φ₇ become this run's yield, the hash it hands
 * the chain as its accumulation output. A later yield replaces an earlier one. An
 * unreadable hash: panic.
 */
export function yieldHash(m: Machine, outbox: Outbox): HostExit {
  if (!charge(m, 98)) return "oog";
  const hash = readMemory(m.memory, m.registers[7], 32);
  if (!(hash instanceof Uint8Array)) return "panic"; // the hash isn't readable
  outbox.yielded = hash;
  return setTo(m, OK);
}

/**
 * C (GP App. B.4), for the yield: a halt whose output is 32 bytes yields that output; any
 * other halt, the run's last yield; a panic or running out of gas, the yield the last
 * checkpoint kept.
 */
export function collapseYield(outbox: Outbox, exit: Exit, output?: Bytes): Bytes | undefined {
  if (exit !== "halt") return outbox.keptYield;
  return output ?? outbox.yielded;
}

/** A preimage provided to a service that asked for it (GP §12, a pair in 𝐩). */
export type Provision = { service: number; preimage: Bytes };

/**
 * provide (GP App. B.7, Ω_♈): hands service φ₇ (or this service, if φ₇ is 2^64 − 1) the φ₉
 * bytes at φ₈, a preimage it asked for. It arrives at the end of the round. HUH if φ₉ can't
 * be a length, the service hasn't asked for exactly this preimage or already has it, or
 * this run provided it already; WHO if there's no such service; unreadable bytes: panic.
 */
export function provide(m: Machine, a: Accumulation, outbox: Outbox): HostExit {
  const [w, o, z] = m.registers.slice(7, 10);
  if (!charge(m, 3980n + memoryGas(2264, z))) return "oog";
  if (z >= 2n ** 32n) return setTo(m, HUH); // not a blob's length
  const preimage = readMemory(m.memory, o, Number(z));
  if (!(preimage instanceof Uint8Array)) return "panic"; // the bytes aren't readable
  const s = w === 2n ** 64n - 1n ? a.id : Number(w);
  const account = w < 2n ** 32n || s === a.id ? a.accounts.get(s) : undefined;
  if (!account) return setTo(m, WHO);
  const slots = requestOf(account, s, toHex(blake2b256(preimage)), z);
  if (slots?.length !== 0) return setTo(m, HUH); // not asked for, or not waiting for it
  const provided = (outbox.provided ??= []);
  const same = (p: Provision) => p.service === s && toHex(p.preimage) === toHex(preimage);
  if (provided.some(same)) return setTo(m, HUH); // this run gave it already
  provided.push({ service: s, preimage });
  return setTo(m, OK);
}

/** C (GP App. B.4), for provisions: a halt keeps them all; anything else, only those the
 * last checkpoint kept. */
export function collapseProvided(outbox: Outbox, exit: Exit): Provision[] {
  return (exit === "halt" ? outbox.provided : outbox.keptProvided) ?? [];
}

/**
 * bless (GP App. B.7, Ω_B): sets every privilege at once. Service φ₇ becomes the manager,
 * the C service ids at φ₈ (4 bytes each) the cores' assigners, φ₉ the delegator, φ₁₀ the
 * registrar, and the φ₁₂ entries at φ₁₁ (a 4-byte service id and 8 bytes of gas each) the
 * always-accumulate services. WHO if φ₇, φ₉ or φ₁₀ can't be a service id; unreadable
 * assigners or entries: panic. The 0.8.0 paper also answers HUH to anyone but the manager;
 * the test vectors follow a later change, and let anyone call it (lesson 17.13).
 */
export function bless(m: Machine, powers: Powers, cores: number): HostExit {
  const [manager, at, delegator, registrar, o, n] = m.registers.slice(7, 13);
  if (!charge(m, 422n + 20n * n)) return "oog";
  const assigners = readMemory(m.memory, at, 4 * cores);
  const entries = readMemory(m.memory, o, 12 * Number(n));
  if (!(assigners instanceof Uint8Array) || !(entries instanceof Uint8Array)) return "panic";
  if ([manager, delegator, registrar].some((id) => id >= 2n ** 32n)) return setTo(m, WHO);
  const assign = Array.from({ length: cores }, (_, c) =>
    Number(decodeFixed(assigners.subarray(4 * c, 4 * c + 4))));
  const free = new Map<number, bigint>();
  for (let i = 0; i < Number(n); i++) {
    const entry = entries.subarray(12 * i, 12 * i + 12);
    free.set(Number(decodeFixed(entry.subarray(0, 4))), decodeFixed(entry.subarray(4)));
  }
  const [bless, designate, register] = [manager, delegator, registrar].map(Number);
  powers.now.privileges = { bless, assign, designate, register };
  powers.now.free = free;
  return setTo(m, OK);
}

/**
 * designate (GP App. B.7, Ω_D): the φ₈ sets of validator keys at φ₇ (336 bytes each)
 * become the next validators, ι. Only the delegator may; and φ₈ must be a size the chain
 * allows, a multiple of 3 from 6 to 3 × the cores (else HUH). Unreadable keys: panic.
 */
export function designate(m: Machine, s: number, powers: Powers, cores: number): HostExit {
  const [o, z] = m.registers.slice(7, 9);
  if (!charge(m, 1100n + 302n * z)) return "oog";
  const keys = readMemory(m.memory, o, 336 * Number(z));
  if (!(keys instanceof Uint8Array)) return "panic"; // the keys aren't readable
  const allowed = z % 3n === 0n && z >= 6n && z <= 3n * BigInt(cores); // V
  if (!allowed || s !== powers.now.privileges.designate) return setTo(m, HUH);
  powers.now.staging = Array.from({ length: Number(z) }, (_, i) =>
    keys.slice(336 * i, 336 * i + 336));
  return setTo(m, OK);
}
