import { test } from "node:test";
import assert from "node:assert/strict";
import { Operand, serviceInputs, accumulateBlock, accumulationStateFromJson, accumulateRound, mergePrivileges, outputsRoot, AccumulationOutput } from "../src/accumulate.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { decode, encode } from "../src/codec/codec.ts";
import { TINY } from "../src/config.ts";
import type { Accumulation, Transfer, Privileges, Privileged } from "../src/host.ts";
import { accumulate } from "../src/host.ts";
import { unpackCode } from "../src/pvm/program.ts";
import type { Account, AccountJson, ServiceInfo } from "../src/services.ts";
import { accountFromJson, copyAccounts } from "../src/services.ts";
import { WorkReport } from "../src/work.ts";
import { vectorJson } from "./vectors.ts";
import type { AccumulationStateJson, AccumulationState, AccumulationStats } from "../src/accumulate.ts";
import type { Bytes } from "../src/bytes.ts";
import { keccak256 } from "../src/hash.ts";

/** The parts of an accumulate test vector these tests read. */
type Vector = {
  input: { slot: number; reports: unknown[] };
  pre_state: {
    entropy: string;
    privileges: Privileges & { always_acc: { id: number; gas: number }[] };
    accounts: {
      id: number;
      data: AccountJson & {
        service: { code_hash: string };
        preimage_blobs: { hash: string; blob: string }[];
      };
    }[];
  };
  post_state: {
    statistics: { id: number; record: Record<string, number> }[];
    accounts: { id: number; data: AccountJson }[];
  };
};

/** A vector's work-reports, decoded. */
const reportsOf = (vector: { input: { reports: unknown[] } }) =>
  vector.input.reports.map((r) => WorkReport.fromJson(r));

test("an operand: a 0, the report's three hashes, the payload's, the gas, result and trace", () => {
  const vector = vectorJson("stf/accumulate/tiny/process_one_immediate_report-1.json") as Vector;
  const [report] = reportsOf(vector);
  const { inputs, gas } = serviceInputs([report], 1729);
  assert.equal(inputs.length, 1); // one digest for service 1729
  const kind: number = inputs[0][0];
  assert.equal(kind, 0); // an operand, not a transfer
  const operand = decode(Operand, inputs[0].subarray(1));
  assert.deepEqual(operand.package_hash, report.package_spec.hash);
  assert.equal(gas, report.results[0].accumulate_gas); // the digest's gas, and no more
});

/** Service s's accumulation in test vector `name`, every report in it accumulated at once. */
function runVector(name: string, s: number) {
  const vector = vectorJson(`stf/accumulate/tiny/${name}.json`) as Vector;
  const accounts = new Map(vector.pre_state.accounts.map((a) => [a.id, accountFromJson(a.data)]));
  const { data } = vector.pre_state.accounts.find((a) => a.id === s)!;
  const preimage = data.preimage_blobs.find((p) => p.hash === data.service.code_hash)!;
  const free = vector.pre_state.privileges.always_acc.find((x) => x.id === s)?.gas ?? 0;
  const { inputs, gas } = serviceInputs(reportsOf(vector), s, BigInt(free));
  const { bless, assign, designate, register } = vector.pre_state.privileges;
  const a: Accumulation = {
    id: s,
    accounts,
    checkpoint: copyAccounts(accounts),
    code: unpackCode(fromHex(preimage.blob)),
    entropy: fromHex(vector.pre_state.entropy),
    inputs,
    privileges: { bless, assign, designate, register },
  };
  const post = vector.post_state;
  return {
    result: accumulate(TINY, a, vector.input.slot, gas),
    gas: BigInt(post.statistics.find((x) => x.id === s)!.record.accumulate_gas_used),
    after: accountFromJson(post.accounts.find((x) => x.id === s)!.data),
  };
}

/** The vectors whose services need no host calls beyond this part's so far. */
const CASES: [string, number][] = [
  ["always_accumulate-1", 1729],
  ["always_accumulate-2", 1729],
  ["lookup_foreign_preimage-1", 0],
  ["lookup_foreign_preimage-2", 0],
  ["preimage_len_bound-1", 0],
  ["preimage_len_bound-2", 0],
  ["preimage_len_bound-3", 0],
  ["process_one_immediate_report-1", 1729],
  ["queues_are_shifted-1", 1729],
  ["same_code_different_services-1", 1729],
  ["same_round_storage_isolation-1", 1729],
  ["same_round_storage_isolation-1", 1730],
  ["same_round_storage_isolation-2", 1730],
  ["transfer_for_live_service-1", 0], // from here on: services that send a transfer
  ["transfer_for_ejected_service-1", 0],
  ["transfer_for_ejected_service_that_accumulates_high_ejector-1", 1],
  ["transfer_for_ejected_service_that_accumulates_low_ejector-1", 1],
  ["transfer_for_service_ejected_in_same_round_high_ejector-1", 1],
  ["transfer_for_service_ejected_in_same_round_low_ejector-1", 1],
  ["recreate_ejected_service_by_higher_registrar-1", 1],
  ["recreate_ejected_service_that_accumulates-1", 1],
  ["assign_from_non_assigner-1", 1], // from here on: services that call assign
  ["assign_from_non_assigner-2", 0],
  ["assign_from_non_assigner-3", 0],
];

/** Checks service s's accumulation in test vector `name` against the vector's post-state. */
function checkVector(name: string, s: number) {
  const { result, gas, after } = runVector(name, s);
  assert.equal(result.gasUsed, gas);
  const mine: Account = result.accounts.get(s)!;
  assert.deepEqual(mine.storage, after.storage);
  assert.deepEqual(mine.requests, after.requests);
  assert.deepEqual([mine.info.items, mine.info.bytes], [after.info.items, after.info.bytes]);
}

for (const [name, s] of CASES) {
  test(`${name}: service ${s} ends as the vector says`, () => checkVector(name, s));
}

/** Checks the whole block of test vector `name`: accounts, privileges, statistics, queue
 * and history, and the root of its outputs. The accounts go piece by piece, their code
 * last, so a red has a short diff. */
function checkBlock(name: string) {
  const vector = vectorJson(`stf/accumulate/tiny/${name}.json`) as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const { state, statistics, outputs } =
    accumulateBlock(TINY, before, vector.input.slot, reportsOf(vector));
  const expected: AccumulationState = accumulationStateFromJson(vector.post_state);
  const root: string = toHex(outputsRoot(outputs)); // the vector's output: θ′'s root
  assert.equal(root, vector.output.ok);
  const infos: Map<number, ServiceInfo> = each(state.accounts, (a) => a.info);
  const expectedInfos: Map<number, ServiceInfo> = each(expected.accounts, (a) => a.info);
  assert.deepEqual(infos, expectedInfos);
  const storage: Map<number, Map<string, Bytes>> = each(state.accounts, (a) => a.storage);
  const expectedStorage: Map<number, Map<string, Bytes>> =
    each(expected.accounts, (a) => a.storage);
  assert.deepEqual(storage, expectedStorage);
  const requests: Map<number, Map<string, number[]>> = each(state.accounts, (a) => a.requests);
  const expectedRequests: Map<number, Map<string, number[]>> =
    each(expected.accounts, (a) => a.requests);
  assert.deepEqual(requests, expectedRequests);
  const hashes = (a: Account) => [...a.preimages.keys()].sort(); // the preimages' hashes
  const preimages: Map<number, string[]> = each(state.accounts, hashes);
  const expectedPreimages: Map<number, string[]> = each(expected.accounts, hashes);
  assert.deepEqual(preimages, expectedPreimages);
  assert.deepEqual(state.accounts, expected.accounts); // all of it, the code included
  assert.deepEqual(state.privileges, expected.privileges);
  assert.deepEqual(state.free, expected.free);
  assert.deepEqual(state.ready, expected.ready);
  assert.deepEqual(state.accumulated, expected.accumulated);
  const stats = vector.post_state.statistics.map(({ id, record: r }) => {
    const gasUsed = BigInt(r.accumulate_gas_used);
    return [id, { count: r.accumulate_count, transfers: r.accumulate_transfer_count, gasUsed }];
  });
  assert.deepEqual(statistics, new Map(stats as [number, unknown][]));
}

/** The vectors whose whole block needs nothing beyond this lesson. */
const BLOCK_CASES = [
  "accumulate_ready_queued_reports-1", "always_accumulate-1", "always_accumulate-2",
  "assign_from_non_assigner-1", "assign_from_non_assigner-2", "assign_from_non_assigner-3",
  "bless_from_non_manager-1", "bless_from_non_manager-2", "create_service-1",
  "designate_with_invalid_count-1", "designate_with_invalid_count-2", "enqueue_and_unlock_chain-1",
  "enqueue_and_unlock_chain-2", "enqueue_and_unlock_chain-3", "enqueue_and_unlock_chain-4",
  "enqueue_and_unlock_chain_wraps-1", "enqueue_and_unlock_chain_wraps-2",
  "enqueue_and_unlock_chain_wraps-3", "enqueue_and_unlock_chain_wraps-4",
  "enqueue_and_unlock_chain_wraps-5", "enqueue_and_unlock_simple-1", "enqueue_and_unlock_simple-2",
  "enqueue_and_unlock_with_sr_lookup-1", "enqueue_and_unlock_with_sr_lookup-2",
  "enqueue_self_referential-1", "enqueue_self_referential-2", "enqueue_self_referential-3",
  "enqueue_self_referential-4", "lookup_foreign_preimage-1", "lookup_foreign_preimage-2",
  "no_available_reports-1", "preimage_len_bound-1", "preimage_len_bound-2", "preimage_len_bound-3",
  "provide_preimage-1", "provide_preimage-2", "process_one_immediate_report-1",
  "queues_are_shifted-1", "queues_are_shifted-2", "ready_queue_editing-1", "ready_queue_editing-2",
  "ready_queue_editing-3", "recreate_ejected_service-1",
  "recreate_ejected_service_by_higher_registrar-1", "recreate_ejected_service_that_accumulates-1",
  "recreate_service_ejected_in_earlier_round-1", "same_code_different_services-1",
  "same_round_storage_isolation-1", "same_round_storage_isolation-2",
  "transfer_for_ejected_service-1", "transfer_for_ejected_service_that_accumulates_high_ejector-1",
  "transfer_for_ejected_service_that_accumulates_low_ejector-1", "transfer_for_live_service-1",
  "transfer_for_service_ejected_in_same_round_high_ejector-1",
  "transfer_for_service_ejected_in_same_round_low_ejector-1",
  "transfer_to_service_ejected_by_sender_eject_first-1",
  "transfer_to_service_ejected_by_sender_transfer_first-1", "upgrade_service-1",
  "work_for_ejected_service-1", "work_for_ejected_service-2", "work_for_ejected_service-3",
  "work_for_service_ejected_in_same_round_high_ejector-1",
  "work_for_service_ejected_in_same_round_low_ejector-1",
];

for (const name of BLOCK_CASES) {
  test(`${name}: the block ends as the vector says`, () => checkBlock(name));
}

/** A whole accumulate test vector: the input, the state before and after. */
type BlockVector = {
  input: { slot: number; reports: unknown[] };
  output: { ok: string };
  pre_state: AccumulationStateJson;
  post_state: AccumulationStateJson & { statistics: Vector["post_state"]["statistics"] };
};

test("a report waiting for package A goes in the same block as A", () => {
  const vector = vectorJson("stf/accumulate/tiny/enqueue_and_unlock_simple-2.json") as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const waiting: number = before.ready.flat().length; // D waits for A
  assert.equal(waiting, 1);
  const [a] = reportsOf(vector); // the block brings A, which waits for nothing
  const { state } = accumulateBlock(TINY, before, vector.input.slot, [a]);
  const stillWaiting: number = state.ready.flat().length; // D has gone
  assert.equal(stillWaiting, 0);
  const accumulated: number = state.accumulated.at(-1)!.size; // A and D, both accumulated now
  assert.equal(accumulated, 2);
});

test("a gift: service 0 sends service 1 a hundred, with a memo", () => {
  const { result, after } = runVector("transfer_for_live_service-1", 0);
  const [gift]: Transfer[] = result.transfers;
  assert.deepEqual([gift.source, gift.dest, gift.amount, gift.gas], [0, 1, 100n, 80_000n]);
  const memo: string = new TextDecoder().decode(gift.memo.subarray(0, 4));
  assert.equal(memo, "gift");
  const balance: bigint = result.accounts.get(0)!.info.balance; // 227,714 − 100
  assert.equal(balance, after.info.balance);
});

test("the gift arrives a round later: the money first, then service 1 runs", () => {
  const vector = vectorJson("stf/accumulate/tiny/transfer_for_live_service-1.json") as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const { state, statistics } = accumulateBlock(TINY, before, vector.input.slot, reportsOf(vector));
  const receiver: Account = state.accounts.get(1)!;
  const received: bigint = receiver.info.balance; // the gift arrived
  assert.equal(received, 227_714n + 100n);
  const stats: AccumulationStats | undefined = statistics.get(1);
  assert.deepEqual(stats, { count: 0, transfers: 1, gasUsed: 61_711n });
  const note: Bytes = receiver.storage.get(toHex(new TextEncoder().encode("transfer0")))!;
  const memo: string = new TextDecoder().decode(note.subarray(12, 16)); // it read the memo
  assert.equal(memo, "gift");
});

test("a transfer to a service with no code: the money arrives, and nothing runs", () => {
  const vector = vectorJson("stf/accumulate/tiny/transfer_for_live_service-1.json") as BlockVector;
  const { accounts, entropy } = accumulationStateFromJson(vector.pre_state);
  accounts.get(1)!.preimages.clear(); // service 1 can't find its code now
  const gift: Transfer = { source: 0, dest: 1, amount: 100n, memo: new Uint8Array(128), gas: 10n };
  const round = accumulateRound(TINY, accounts, new Map(), entropy, 43, [], [gift]);
  const balance: bigint = round.accounts.get(1)!.info.balance; // the money, still
  assert.equal(balance, 227_714n + 100n);
  const used: bigint | undefined = round.used.get(1); // no code: no gas
  assert.equal(used, 0n);
  assert.deepEqual(round.transfers, []); // and nothing sent on
});

test("the assigner hands core 0 to service 1", () => {
  const { result } = runVector("assign_from_non_assigner-3", 0);
  const assigned: number[] = result.privileged.privileges.assign; // as the vector's χ_A ends
  assert.deepEqual(assigned, [1, 0]);
  const queueLength: number = result.privileged.queues.get(0)!.length; // core 0's new queue
  assert.equal(queueLength, 80);
});

test("who wins: the manager's change over the holder's, the holder's over nobody's", () => {
  const before: Privileges = { bless: 0, assign: [1, 1], designate: 0, register: 0 };
  const left = (assign: number[], queues = new Map()) => ({
    privileges: { ...before, assign },
    queues,
  });
  const queue = [new Uint8Array(32).fill(9)]; // service 1's new queue for core 1
  const runs = new Map([
    [0, left([5, 1])], // the manager gives core 0 to service 5, and leaves core 1 alone
    [1, left([7, 7], new Map([[1, queue]]))], // service 1 gives both cores to service 7
  ]);
  const after: Privileged = mergePrivileges(before, runs);
  assert.deepEqual(after.privileges.assign, [5, 7]); // core 0: the manager's; core 1: its own
  assert.deepEqual([...after.queues], [[1, queue]]); // the queue its assigner set
});

test("a core changes hands for the whole block, with a new queue", () => {
  const vector = vectorJson("stf/accumulate/tiny/assign_from_non_assigner-3.json") as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const { state, queues } = accumulateBlock(TINY, before, vector.input.slot, reportsOf(vector));
  assert.deepEqual([before.privileges.assign, state.privileges.assign], [[0, 0], [1, 0]]);
  const queueLength: number = queues.get(0)!.length; // for Part 13's ϕ
  assert.equal(queueLength, 80);
});

test("an ejected service is gone, and its ejector has its balance", () => {
  const vector = vectorJson("stf/accumulate/tiny/work_for_ejected_service-2.json") as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const { state } = accumulateBlock(TINY, before, vector.input.slot, reportsOf(vector));
  const stillThere: boolean = state.accounts.has(2); // service 2 named service 0 as its ejector
  assert.equal(stillThere, false);
  const ejectorBalance: bigint = state.accounts.get(0)!.info.balance; // and 0 ejected it
  assert.equal(ejectorBalance, 227_714n + 227_714n);
});

test("the registrar creates service 5, which gets its endowment a round later", () => {
  const vector = vectorJson("stf/accumulate/tiny/create_service-1.json") as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const { state, statistics } = accumulateBlock(TINY, before, vector.input.slot, reportsOf(vector));
  const made: ServiceInfo = state.accounts.get(5)!.info;
  assert.deepEqual([made.parent_service, made.creation_slot], [0, 43]); // service 0, this block
  assert.equal(made.balance, 1201n + 500n); // its minimum (100 + 2 × 10 + 1081), and a gift
  const delivered: number = statistics.get(5)!.transfers; // the gift, delivered in round 2
  assert.equal(delivered, 1);
});

/** Each account's `part`, by service id: small enough for a diff you can read. */
function each<T>(accounts: Map<number, Account>, part: (a: Account) => T): Map<number, T> {
  return new Map([...accounts].map(([s, a]) => [s, part(a)]));
}

test("a block over budget: the second report waits a round, after the eject it needs", () => {
  const name = "stf/accumulate/tiny/recreate_service_ejected_in_earlier_round-1.json";
  const vector = vectorJson(name) as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const { state, rounds } = accumulateBlock(TINY, before, vector.input.slot, reportsOf(vector));
  assert.deepEqual(rounds, [1, 1]); // round 1 takes all 20M of the budget, so one report each
  const created: number = state.accounts.get(2)!.info.creation_slot; // was 0
  assert.equal(created, 43); // round 1 ejected service 2, round 2 made a new one
});

test("service 1 yields a hash: the block's one output, and its root", () => {
  const name = "stf/accumulate/tiny/work_for_ejected_service-3.json";
  const vector = vectorJson(name) as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const { outputs } = accumulateBlock(TINY, before, vector.input.slot, reportsOf(vector));
  const [output]: AccumulationOutput[] = outputs;
  assert.equal(outputs.length, 1);
  assert.equal(output.service, 1);
  const leaf: Bytes = encode(AccumulationOutput, output); // E₄(1) ⌢ h: 36 bytes
  const root: Bytes = outputsRoot(outputs); // one output: the root is its leaf's hash
  assert.deepEqual(root, keccak256(leaf));
});

test("service 0 provides 1729's preimage: it arrives at the end of the round, slot 44", () => {
  const vector = vectorJson("stf/accumulate/tiny/provide_preimage-2.json") as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const hash = "0x943e3d42cf248c99fa6346c24b66741090bd2c78f9ff691c5fd7a88ef51d27e2";
  const asked: number[] = before.accounts.get(1729)!.requests.get(`${hash}:8`)!;
  assert.deepEqual(asked, []); // 1729 asked for these 8 bytes, and waits
  const { state } = accumulateBlock(TINY, before, vector.input.slot, reportsOf(vector));
  const account: Account = state.accounts.get(1729)!;
  const arrived: number[] = account.requests.get(`${hash}:8`)!;
  assert.deepEqual(arrived, [44]);
  const preimage: string = new TextDecoder().decode(account.preimages.get(hash));
  assert.equal(preimage, "preimage");
});

test("the delegator blesses service 2 as the delegator, though it isn't the manager", () => {
  const vector = vectorJson("stf/accumulate/tiny/bless_from_non_manager-1.json") as BlockVector;
  const before: AccumulationState = accumulationStateFromJson(vector.pre_state);
  const { state } = accumulateBlock(TINY, before, vector.input.slot, reportsOf(vector));
  const managers: number[] = [before.privileges.bless, state.privileges.bless];
  assert.deepEqual(managers, [0, 0]); // service 0 manages throughout; service 1 ran
  const delegators: number[] = [before.privileges.designate, state.privileges.designate];
  assert.deepEqual(delegators, [1, 2]); // service 1's own choice, as R allows
});
