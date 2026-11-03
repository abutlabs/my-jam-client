// Services and their preimages (GP §9, §12): a service asks for some data by its hash and
// length, and a later block provides it.

import type { Preimage } from "./block.ts";
import { toHex, fromHex } from "./bytes.ts";
import { decode, encode, seq, u32, hash, record, u64, u8 } from "./codec/codec.ts";
import { blake2b256 } from "./hash.ts";
import { preimageKey, requestKey, accountKey, storageKey, preimageHashKey } from "./state.ts";
import type { KeyValue } from "./trie.ts";
import type { Value } from "./codec/codec.ts";
import type { Bytes } from "./bytes.ts";

/**
 * A request's history (GP §9), the slots of its life so far: [] asked for, [x] provided
 * at x, [x, y] forgotten at y, [x, y, z] asked for again at z.
 */
export const RequestHistory = seq(u32);

/**
 * I (GP §12): give each preimage to the service that asked for it, if it's still waiting
 * (Y, "providable"): store the data, and mark the request provided at this slot.
 */
export function providePreimages(
  entries: KeyValue[],
  preimages: Preimage[],
  slot: number, // τ′
): KeyValue[] {
  const state = new Map(entries.map((entry) => [toHex(entry.key), entry]));
  for (const { requester, blob } of preimages) {
    const request = requestKey(requester, blake2b256(blob), blob.length);
    const history = state.get(toHex(request));
    if (history === undefined) continue; // never asked for
    if (decode(RequestHistory, history.value).length !== 0) continue; // not waiting now
    state.set(toHex(request), { key: request, value: encode(RequestHistory, [slot]) });
    const key = preimageKey(requester, blob);
    state.set(toHex(key), { key, value: blob });
  }
  return [...state.values()];
}

/** A service's account record, C(255, s) (GP §9, App. D), under the test vectors' names. */
export const ServiceInfo = record({
  version: u8, // 0
  code_hash: hash, // c: the hash of the service's code, itself a preimage it keeps
  balance: u64, // b
  min_item_gas: u64, // g: the least gas to accumulate each work-item
  min_memo_gas: u64, // m: the least gas for each transfer's memo
  bytes: u64, // o: the octets its storage, preimages and requests take
  deposit_offset: u64, // f: gratis storage, a discount on the deposit below
  items: u32, // i: how many things it keeps
  creation_slot: u32, // r
  last_accumulation_slot: u32, // a
  parent_service: u32, // p: the service that created it
});
export type ServiceInfo = Value<typeof ServiceInfo>;

/** A service's account record, read from the state (lesson 6.2's C(255, s)). */
export function readService(entries: KeyValue[], s: number): ServiceInfo {
  const key = toHex(accountKey(s));
  const entry = entries.find((e) => toHex(e.key) === key);
  if (!entry) throw new Error(`the state has no service ${s}`);
  return decode(ServiceInfo, entry.value);
}

/** A service's code (GP §9): the preimage of its code hash, which it keeps in the state. */
export function serviceCode(entries: KeyValue[], s: number): Bytes | undefined {
  const { code_hash } = readService(entries, s);
  return entries.find((e) => toHex(blake2b256(e.value)) === toHex(code_hash))?.value;
}

/**
 * The footprint (GP §9): items is 2 per request and 1 per storage entry; bytes is 81 plus
 * the length per request, and 34 plus key and value lengths per storage entry.
 */
export function footprint(
  storage: { key: Bytes; value: Bytes }[],
  requests: { length: number }[],
): { items: number; bytes: bigint } {
  const items = 2 * requests.length + storage.length;
  let bytes = 0n;
  for (const { length } of requests) bytes += BigInt(81 + length);
  for (const { key, value } of storage) bytes += BigInt(34 + key.length + value.length);
  return { items, bytes };
}

/** a_t (GP §9): the least balance a service must keep for what it stores. */
export function minimumBalance(info: ServiceInfo): bigint {
  const deposit = 100n + 10n * BigInt(info.items) + info.bytes; // B_S + B_I·i + B_L·o
  const owed = deposit - info.deposit_offset;
  return owed > 0n ? owed : 0n;
}

/**
 * A service account (GP §9) as accumulation sees it: its record, its storage, the
 * preimages it keeps, each under its hash, and its requests for preimages: for each hash
 * and length ("hash:length"), the slots it was asked for, provided, and so on. Keys in hex.
 */
export type Account = {
  info: ServiceInfo;
  storage: Map<string, Bytes>;
  preimages: Map<string, Bytes>;
  requests: Map<string, number[]>;
  items?: Map<string, Bytes>; // read from the state: every entry, by its state key (19.3)
};

/** An account as the accumulate test vectors write it. */
export type AccountJson = {
  service: unknown;
  storage: { key: string; value: string }[];
  preimage_blobs: { hash: string; blob: string }[];
  preimage_requests: { key: { hash: string; length: number }; value: number[] }[];
};

/** An account from the accumulate test vectors' JSON. */
export function accountFromJson(json: AccountJson): Account {
  const storage = new Map(json.storage.map((e) => [e.key, fromHex(e.value)]));
  const preimages = new Map(json.preimage_blobs.map((p) => [p.hash, fromHex(p.blob)]));
  const requests = new Map(
    json.preimage_requests.map((r) => [`${r.key.hash}:${r.key.length}`, r.value]),
  );
  return { info: ServiceInfo.fromJson(json.service), storage, preimages, requests };
}

/** A copy of the accounts that changes to the originals can't reach. */
export function copyAccounts(accounts: Map<number, Account>): Map<number, Account> {
  const copy = (a: Account) => ({
    info: { ...a.info },
    storage: new Map(a.storage),
    preimages: new Map(a.preimages),
    requests: new Map([...a.requests].map(([k, slots]) => [k, [...slots]])),
    ...(a.items && { items: new Map(a.items) }), // only an account read from the state
  });
  return new Map([...accounts].map(([id, a]) => [id, copy(a)]));
}

/** The value service s keeps under storage key k: by k itself in a test vector's account,
 * by its state key in an account read from the state. */
export function storageValue(a: Account, s: number, k: Bytes): Bytes | undefined {
  return a.items ? a.items.get(toHex(storageKey(s, k))) : a.storage.get(toHex(k));
}

/** Keeps `value` under storage key k for service s, or drops the key if there's none. */
export function setStorageValue(a: Account, s: number, k: Bytes, value: Bytes | undefined) {
  const [map, key] = a.items ? [a.items, toHex(storageKey(s, k))] : [a.storage, toHex(k)];
  if (value) map.set(key, value);
  else map.delete(key);
}

/** The preimage of hash h (in hex) that service s keeps, if any. */
export function preimageOf(a: Account, s: number, h: string): Bytes | undefined {
  return a.items ? a.items.get(toHex(preimageHashKey(s, fromHex(h)))) : a.preimages.get(h);
}

/** Keeps the preimage of hash h for service s, or drops it. */
export function setPreimage(a: Account, s: number, h: string, preimage: Bytes | undefined) {
  const [map, key] = a.items ? [a.items, toHex(preimageHashKey(s, fromHex(h)))] : [a.preimages, h];
  if (preimage) map.set(key, preimage);
  else map.delete(key);
}

/** Service s's request for the preimage of hash h (in hex), l bytes long: its history. */
export function requestOf(a: Account, s: number, h: string, l: bigint): number[] | undefined {
  if (!a.items) return a.requests.get(`${h}:${l}`);
  const value = a.items.get(toHex(requestKey(s, fromHex(h), Number(l))));
  return value && decode(RequestHistory, value);
}

/** Records service s's request for hash h, l bytes long, as `slots`, or drops it. */
export function setRequest(a: Account, s: number, h: string, l: bigint, slots?: number[]) {
  if (!a.items) {
    if (slots) a.requests.set(`${h}:${l}`, slots);
    else a.requests.delete(`${h}:${l}`);
    return;
  }
  const key = toHex(requestKey(s, fromHex(h), Number(l)));
  if (slots) a.items.set(key, encode(RequestHistory, slots));
  else a.items.delete(key);
}
