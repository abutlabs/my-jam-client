// The whole state, σ (GP App. D): every component and every service account, read from
// the state's entries and written back, so that a block can be imported into a real state.

import type { Bytes } from "./bytes.ts";
import { fromHex, toHex } from "./bytes.ts";
import type { Codec, Value } from "./codec/codec.ts";
import { decode, encode, hash, record, seq, seqN, u32, u64 } from "./codec/codec.ts";
import type { Config } from "./config.ts";
import { AuthPools, AuthQueues } from "./authorization.ts";
import { Recent } from "./history.ts";
import { SafroleState, ValidatorKey, accountKey, componentKey } from "./state.ts";
import { PastJudgements } from "./disputes.ts";
import { PendingReports } from "./cores.ts";
import { ValidatorStats, CoreStats, ServiceStats } from "./statistics.ts";
import { AccumulationOutput } from "./accumulate.ts";
import { ServiceInfo } from "./services.ts";
import type { Account } from "./services.ts";
import { WorkReport } from "./work.ts";
import type { KeyValue } from "./trie.ts";

/** χ, C(12): the privileged services, then the always-accumulate ones with their gas. */
export function PrivilegesCodec(config: Config) {
  return record({
    bless: u32, // χ_M
    assign: seqN(u32, config.core_count), // χ_A
    designate: u32, // χ_V
    register: u32, // χ_R
    always_acc: seq(record({ id: u32, gas: u64 })), // χ_Z, by service id
  });
}

/** π, C(13): this epoch's and the last's validator tallies, the cores', the services'. */
export function StatisticsCodec(config: Config) {
  return record({
    vals_curr: seq(ValidatorStats), // π_V
    vals_last: seq(ValidatorStats), // π_L
    cores: seqN(CoreStats, config.core_count), // π_C
    services: seq(record({ id: u32, record: ServiceStats })), // π_S, by service id
  });
}

/** ω, C(14): for each slot of an epoch, the reports waiting, and what each waits for. */
export function ReadyQueueCodec(config: Config) {
  const waiting = record({ report: WorkReport, dependencies: seq(hash) });
  return seqN(seq(waiting), config.epoch_length);
}

/** ξ, C(15): for each of the last E slots, the work-packages accumulated in it. */
export function AccumulatedCodec(config: Config) {
  return seqN(seq(hash), config.epoch_length);
}

/** θ, C(16): the last block's accumulation outputs. */
export const OutputsCodec = seq(AccumulationOutput);


/** σ: every component of the state, by its Gray Paper letter, and the accounts, δ. */
export function StateComponents(config: Config) {
  return {
    1: AuthPools(config), // α
    2: AuthQueues(config), // ϕ
    3: Recent, // β
    4: SafroleState(config), // γ
    5: PastJudgements, // ψ
    6: seqN(hash, 4), // η
    7: seq(ValidatorKey), // ι
    8: seq(ValidatorKey), // κ
    9: seq(ValidatorKey), // λ
    10: PendingReports(config), // ρ
    11: u32, // τ
    12: PrivilegesCodec(config), // χ
    13: StatisticsCodec(config), // π
    14: ReadyQueueCodec(config), // ω
    15: AccumulatedCodec(config), // ξ
    16: OutputsCodec, // θ
  } satisfies Record<number, Codec<unknown>>;
}

type Components = ReturnType<typeof StateComponents>;

/** The whole state: each component, decoded, and the service accounts. */
export type State = { [i in keyof Components]: Value<Components[i]> } & {
  accounts: Map<number, Account>; // each read with its entries, `items` (lesson 19.3)
};

/** The service an entry belongs to, if it is one of a service's entries, C(s, h): ℰ₄(s) is
 * woven into bytes 0, 2, 4 and 6. Component keys and account records are not. */
function ownerOf(key: Bytes): number | undefined {
  if (key.subarray(1).every((b) => b === 0)) return undefined; // C(i): a component
  const record = [2, 4, 6].every((i) => key[i] === 0) && key.subarray(8).every((b) => b === 0);
  if (key[0] === 255 && record) {
    return undefined; // C(255, s): an account's record
  }
  return (key[0] | (key[2] << 8) | (key[4] << 16) | (key[6] << 24)) >>> 0;
}

/** σ, read from the state's entries: every component decoded, every account gathered. */
export function readState(config: Config, entries: KeyValue[]): State {
  const byKey = new Map(entries.map((e) => [toHex(e.key), e.value]));
  const components = StateComponents(config);
  const state = {} as Record<number, unknown>;
  for (const [i, codec] of Object.entries(components)) {
    const value = byKey.get(toHex(componentKey(Number(i))));
    if (value === undefined) throw new Error(`the state has no component ${i}`);
    state[Number(i)] = decode(codec as Codec<unknown>, value);
  }
  const accounts = new Map<number, Account>();
  for (const { key, value } of entries) {
    if (key[0] !== 255 || toHex(key) !== toHex(accountKey(serviceOfAccountKey(key)))) continue;
    const info = decode(ServiceInfo, value);
    const empty = { storage: new Map(), preimages: new Map(), requests: new Map() };
    accounts.set(serviceOfAccountKey(key), { info, ...empty, items: new Map() });
  }
  for (const { key, value } of entries) {
    const s = ownerOf(key);
    if (s !== undefined) accounts.get(s)?.items?.set(toHex(key), value);
  }
  return { ...(state as Omit<State, "accounts">), accounts };
}

/** The service s an account record's key C(255, s) names. */
function serviceOfAccountKey(key: Bytes): number {
  return (key[1] | (key[3] << 8) | (key[5] << 16) | (key[7] << 24)) >>> 0;
}

/** σ, written as the state's entries: each component encoded, each account's record and
 * entries. */
export function writeState(config: Config, state: State): KeyValue[] {
  const entries: KeyValue[] = [];
  for (const [i, codec] of Object.entries(StateComponents(config))) {
    const value = state[Number(i) as keyof Components];
    entries.push({ key: componentKey(Number(i)), value: encode(codec as Codec<unknown>, value) });
  }
  for (const [s, account] of state.accounts) {
    entries.push({ key: accountKey(s), value: encode(ServiceInfo, account.info) });
    for (const [key, value] of account.items ?? []) entries.push({ key: fromHex(key), value });
  }
  return entries;
}
