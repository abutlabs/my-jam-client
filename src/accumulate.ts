// Accumulation (GP §12): what a block's work-reports ask of each service. This file starts
// with one service's share of them: its inputs, and the gas to run them.

import type { Bytes } from "./bytes.ts";
import { concatBytes, toHex, fromHex } from "./bytes.ts";
import { blob, encode, hash, natural, record, u32 } from "./codec/codec.ts";
import { WorkResult, WorkReport } from "./work.ts";
import type { Config } from "./config.ts";
import { accumulate, Transfer, NO_PRIVILEGES } from "./host.ts";
import type { ServiceCode } from "./pvm/program.ts";
import { unpackCode } from "./pvm/program.ts";
import type { Account, AccountJson } from "./services.ts";
import { copyAccounts, accountFromJson, preimageOf, requestOf, setRequest, setPreimage } from "./services.ts";
import type { Privileged, Privileges, Provision } from "./host.ts";
import { REPORT_GAS } from "./guarantors.ts";
import type { Value } from "./codec/codec.ts";
import { wellBalancedRoot } from "./belt.ts";
import { blake2b256 } from "./hash.ts";

/**
 * An operand (GP §12, U): what accumulation learns of one work-digest. From its report:
 * the package, its exports' root and its authorizer; from the digest itself: its payload's
 * hash, its gas, its result; and the authorizer's trace.
 */
export const Operand = record({
  package_hash: hash,
  exports_root: hash,
  authorizer_hash: hash,
  payload_hash: hash,
  gas: natural,
  result: WorkResult,
  auth_trace: blob,
});

/**
 * Service s's share of a round (GP §12, Δ₁): its inputs, first the transfers sent to it,
 * then one operand for each of its digests, in order; and its gas: `free` gas, plus every
 * one of those transfers' and digests' gas. Each input starts with what it is: 1 for a
 * transfer, 0 for an operand.
 */
export function serviceInputs(
  reports: WorkReport[],
  s: number,
  free = 0n,
  transfers: Transfer[] = [],
) {
  const inputs: Bytes[] = [];
  let gas = free;
  for (const t of transfers.filter((t) => t.dest === s)) {
    inputs.push(concatBytes(Uint8Array.of(1), encode(Transfer, t)));
    gas += t.gas;
  }
  for (const report of reports) {
    for (const digest of report.results.filter((d) => d.service_id === s)) {
      const operand = {
        package_hash: report.package_spec.hash,
        exports_root: report.package_spec.exports_root,
        authorizer_hash: report.authorizer_hash,
        payload_hash: digest.payload_hash,
        gas: digest.accumulate_gas,
        result: digest.result,
        auth_trace: report.auth_output,
      };
      inputs.push(concatBytes(Uint8Array.of(0), encode(Operand, operand)));
      gas += digest.accumulate_gas;
    }
  }
  return { inputs, gas };
}

/** Service s's code (GP §9, a_c): its preimage of its own code hash, unpacked. */
function codeOf(account: Account, s: number): ServiceCode | undefined {
  const preimage = preimageOf(account, s, toHex(account.info.code_hash));
  return preimage && unpackCode(preimage);
}

/**
 * S(s) (GP §12): what accumulation did for one service in a block: how many digests it
 * accumulated (N), how many transfers it received (T), and the gas it used (G).
 */
export type AccumulationStats = { count: number; transfers: number; gasUsed: bigint };

/**
 * A block's accumulation (GP §12): the reports that can go now (R!, then what they and
 * the history unlock from the queue: R*) accumulate in a first round, and the transfers
 * each round sends are delivered in the next, until a round sends none (Δ+). Every
 * service that did anything gets its statistics and its last-accumulation slot; the
 * history ξ moves on one slot, and the reports still waiting go back into the queue ω.
 * The privileges carry from round to round; the cores' new authorizer queues come back
 * beside the statistics. Each round takes as many reports as the block's gas budget
 * allows; `rounds` says how many it took. `outputs` are the hashes services yielded, θ′;
 * `staging` the next validators, ι′, if the delegator chose them.
 */
export function accumulateBlock(
  config: Config,
  state: AccumulationState,
  slot: number, // τ′
  reports: WorkReport[], // the reports that just became available
) {
  const E = config.epoch_length;
  const waits = (r: WorkReport) =>
    r.context.prerequisites.length > 0 || r.segment_root_lookup.length > 0;
  const dependencies = (r: WorkReport) => [
    ...r.context.prerequisites,
    ...r.segment_root_lookup.map((l) => l.work_package_hash),
  ];
  const history = new Set(state.accumulated.flatMap((x) => [...x])); // ξ∪
  const now = reports.filter((r) => !waits(r)); // R!
  const fresh = reports.filter(waits).map((r) => ({
    report: r,
    dependencies: new Set(dependencies(r).map(toHex)),
  }));
  const queued = edit(fresh, history); // R^Q
  const m = slot % E;
  const ring = [...state.ready.slice(m), ...state.ready.slice(0, m)].flat();
  const all = [...now, ...unlock(edit([...ring, ...queued], new Set(now.map(packageOf))))];

  const gasOf = (r: WorkReport) => sum(r.results.map((d) => d.accumulate_gas));
  const freeGas = sum([...state.free.values()]);
  const floor = REPORT_GAS * BigInt(config.core_count) + freeGas;
  let budget = config.max_block_gas > floor ? config.max_block_gas : floor; // g
  let accounts = state.accounts;
  let todo = all; // the reports still to accumulate,
  let free = state.free; // the always-accumulate services (first round only),
  let transfers: Transfer[] = []; // and the transfers to deliver
  let privileges = state.privileges;
  let alwaysAccumulate = state.free; // χ_Z, as the rounds leave it
  let staging: Bytes[] | undefined; // ι′, if the delegator chose new validators
  const done: WorkReport[] = []; // the reports that did accumulate
  const rounds: number[] = []; // how many reports each round took
  const outputs: AccumulationOutput[] = []; // b, over every round: θ′
  const queues = new Map<number, Bytes[]>(); // the cores' new authorizer queues, for ϕ′
  const used = new Map<number, bigint>(); // G: gas, over every round
  const received = new Map<number, number>(); // T: transfers delivered
  for (;;) {
    // as many of the reports as fit the budget, with the transfers and the free gas
    let spent = sum(transfers.map((t) => t.gas)) + sum([...free.values()]);
    let fit = 0;
    while (fit < todo.length && spent + gasOf(todo[fit]) <= budget) {
      spent += gasOf(todo[fit]);
      fit++;
    }
    if (fit + transfers.length + free.size === 0) break; // nothing to do: done
    for (const t of transfers) received.set(t.dest, (received.get(t.dest) ?? 0) + 1);
    const round = accumulateRound(
      config, accounts, free, state.entropy, slot, todo.slice(0, fit), transfers, privileges,
    );
    done.push(...todo.slice(0, fit));
    rounds.push(fit);
    for (const [s, gas] of round.used) used.set(s, (used.get(s) ?? 0n) + gas);
    for (const [c, queue] of round.queues) queues.set(c, queue);
    for (const o of round.outputs) if (!outputs.some((x) => sameOutput(x, o))) outputs.push(o);
    accounts = round.accounts;
    privileges = round.privileges;
    alwaysAccumulate = round.free ?? alwaysAccumulate;
    staging = round.staging ?? staging;
    budget += sum(round.transfers.map((t) => t.gas)) - sum([...round.used.values()]); // g*
    todo = todo.slice(fit); // the rest wait for the next round, if any
    free = new Map();
    transfers = round.transfers;
  }
  const digests = done.flatMap((r) => r.results);
  const statistics = new Map<number, AccumulationStats>();
  for (const [s, gasUsed] of used) {
    const count = digests.filter((d) => d.service_id === s).length;
    const transfersIn = received.get(s) ?? 0;
    if (count === 0 && transfersIn === 0 && gasUsed === 0n) continue; // S(s) = (0, 0, 0)
    statistics.set(s, { count, transfers: transfersIn, gasUsed });
    const account = accounts.get(s);
    if (account) account.info.last_accumulation_slot = slot;
  }

  const finished = new Set(done.map(packageOf));
  const accumulated = [...state.accumulated.slice(1), finished]; // ξ′: newest last
  const ready: Waiting[][] = []; // ω′, slot by slot back from m
  for (let i = 0; i < E; i++) {
    const at = (m - i + E) % E;
    if (i === 0) ready[at] = edit(queued, finished); // this block's newcomers
    else if (i < slot - state.slot) ready[at] = []; // slots the chain skipped: emptied
    else ready[at] = edit(state.ready[at], finished);
  }
  const after = { ...state, slot, accounts, privileges, ready, accumulated };
  after.free = alwaysAccumulate; // χ_Z′
  outputs.sort((x, y) => x.service - y.service || (toHex(x.hash) < toHex(y.hash) ? -1 : 1));
  return { state: after, statistics, queues, staging, rounds, outputs };
}

/**
 * Δ* (GP §12), one round: every service with work in `reports`, every always-accumulate
 * service, and every service a transfer is sent to, runs once from the same accounts and
 * keeps its own account as its run leaves it. The transfers' money arrives before its code
 * runs, even if it has none. Every run starts from the same privileges too, and they are
 * merged after the round. Returns the accounts after the round, the gas each service used,
 * the transfers they sent (service by service in order of id), the privileges after the
 * round, and the cores' new authorizer queues.
 */
export function accumulateRound(
  config: Config,
  accounts: Map<number, Account>,
  free: Map<number, bigint>, // χ_Z: the services that accumulate every block, and their gas
  entropy: Bytes,
  slot: number,
  reports: WorkReport[],
  transfers: Transfer[], // the transfers sent in the round before
  privileges = NO_PRIVILEGES, // χ as the round starts
) {
  const digests = reports.flatMap((r) => r.results);
  const ids = [...free.keys(), ...digests.map((d) => d.service_id)];
  const services = [...new Set([...ids, ...transfers.map((t) => t.dest)])].sort((x, y) => x - y);
  const after = copyAccounts(accounts);
  const used = new Map<number, bigint>();
  const sent: Transfer[] = [];
  const powers = new Map<number, Privileged>(); // each run's privileges, as it left them
  const removed = new Set<number>(); // accounts some run ejected
  const outputs: AccumulationOutput[] = []; // b: what each run yielded
  const provided: Provision[] = []; // 𝐩: the preimages runs provided
  for (const s of services) {
    const mine = copyAccounts(accounts); // every service starts from the same accounts
    const account = mine.get(s);
    const money = transfers.filter((t) => t.dest === s).reduce((n, t) => n + t.amount, 0n);
    if (account) account.info = { ...account.info, balance: account.info.balance + money };
    const code = account && codeOf(account, s);
    if (!code) {
      if (account) after.set(s, account); // no code to run: it keeps the money, that's all
      used.set(s, 0n);
      continue;
    }
    const { inputs, gas } = serviceInputs(reports, s, free.get(s) ?? 0n, transfers);
    const checkpoint = copyAccounts(mine);
    const a = { id: s, accounts: mine, checkpoint, code, entropy, inputs, privileges };
    const result = accumulate(config, a, slot, gas);
    const left = result.accounts; // the accounts as this run left them
    after.set(s, left.get(s)!);
    for (const [id, account] of left) if (!accounts.has(id)) after.set(id, account); // new
    for (const id of accounts.keys()) if (!left.has(id)) removed.add(id); // ejected
    used.set(s, result.gasUsed);
    sent.push(...result.transfers);
    powers.set(s, result.privileged);
    if (result.yielded) outputs.push({ service: s, hash: result.yielded });
    provided.push(...result.provided);
  }
  for (const id of removed) after.delete(id); // a removal wins over any run's own copy
  applyProvisions(after, provided, slot); // the preimages provided, last of all
  const { privileges: next, queues, free: nextFree, staging } = mergePrivileges(privileges, powers);
  const merged = { privileges: next, queues, free: nextFree, staging };
  return { accounts: after, used, transfers: sent, ...merged, outputs };
}

/** A report in the ready queue (GP §12, ω), and the packages it still waits for, in hex. */
export type Waiting = { report: WorkReport; dependencies: Set<string> };

/** A report's work-package hash, in hex. */
const packageOf = (r: WorkReport) => toHex(r.package_spec.hash);

/** E (GP §12): the queue without the reports whose packages are done, and without the done
 * packages in what the rest wait for. */
export function edit(queue: Waiting[], done: Set<string>): Waiting[] {
  return queue
    .filter((w) => !done.has(packageOf(w.report)))
    .map((w) => ({
      report: w.report,
      dependencies: new Set([...w.dependencies].filter((d) => !done.has(d))),
    }));
}

/** Q (GP §12): the reports the queue lets go now, in order: those waiting for nothing,
 * then the ones they free up, and so on, until nothing more is free. */
export function unlock(queue: Waiting[]): WorkReport[] {
  const out: WorkReport[] = [];
  for (;;) {
    const free = queue.filter((w) => w.dependencies.size === 0).map((w) => w.report);
    if (free.length === 0) return out;
    out.push(...free);
    queue = edit(queue, new Set(free.map(packageOf)));
  }
}

/** What a block's accumulation reads from the state, and gives back changed (GP §12). */
export type AccumulationState = {
  slot: number; // τ: the slot of the block before
  accounts: Map<number, Account>; // δ
  free: Map<number, bigint>; // χ_Z
  privileges: Privileges; // the rest of χ: manager, assigners, delegator, registrar
  entropy: Bytes; // η′₀
  ready: Waiting[][]; // ω: for each slot of an epoch, the reports that wait
  accumulated: Set<string>[]; // ξ: for each of the last E slots, the packages accumulated
};

/** A block's accumulation state, as the accumulate test vectors write it. */
export type AccumulationStateJson = {
  slot: number;
  entropy: string;
  accounts: { id: number; data: AccountJson }[];
  privileges: Privileges & { always_acc: { id: number; gas: number }[] };
  ready_queue: { report: unknown; dependencies: string[] }[][];
  accumulated: string[][];
};

/** An AccumulationState from the accumulate test vectors' JSON. */
export function accumulationStateFromJson(json: AccumulationStateJson): AccumulationState {
  const waiting = (w: { report: unknown; dependencies: string[] }) => ({
    report: WorkReport.fromJson(w.report),
    dependencies: new Set(w.dependencies),
  });
  return {
    slot: json.slot,
    accounts: new Map(json.accounts.map((a) => [a.id, accountFromJson(a.data)])),
    free: new Map(json.privileges.always_acc.map((x) => [x.id, BigInt(x.gas)])),
    privileges: {
      bless: json.privileges.bless,
      assign: json.privileges.assign,
      designate: json.privileges.designate,
      register: json.privileges.register,
    },
    entropy: fromHex(json.entropy),
    ready: json.ready_queue.map((slot) => slot.map(waiting)),
    accumulated: json.accumulated.map((hashes) => new Set(hashes)),
  };
}

/**
 * R (GP §12): a privilege after a round, from its holder o at the start, the manager's
 * choice for it, and its holder's own choice. The manager's change wins; if the manager
 * left it alone, the holder's own change (perhaps none).
 */
const R = (o: number, manager: number, holder: number) => (manager === o ? holder : manager);

/**
 * The privileges after a round (GP §12, Δ*), from those at its start and each run's, as
 * it left them. A service that didn't run changed nothing. Each core's new authorizer
 * queue is the one its assigner at the start set, if it set one. The always-accumulate
 * services are the manager's, if it set them; the next validators, the delegator's.
 */
export function mergePrivileges(before: Privileges, after: Map<number, Privileged>) {
  const post = (s: number) => after.get(s)?.privileges ?? before;
  const manager = post(before.bless); // what the manager left
  const privileges: Privileges = {
    bless: manager.bless,
    assign: before.assign.map((o, c) => R(o, manager.assign[c], post(o).assign[c])),
    designate: R(before.designate, manager.designate, post(before.designate).designate),
    register: R(before.register, manager.register, post(before.register).register),
  };
  const queues = new Map<number, Bytes[]>();
  before.assign.forEach((o, c) => {
    const queue = after.get(o)?.queues.get(c);
    if (queue) queues.set(c, queue);
  });
  const free = after.get(before.bless)?.free; // χ_Z′, if the manager blessed
  const staging = after.get(before.designate)?.staging; // ι′, if the delegator designated
  return { privileges, queues, free, staging };
}

/** The sum of some amounts of gas. */
const sum = (amounts: bigint[]) => amounts.reduce((n, x) => n + x, 0n);

/** An accumulation output (GP §12, a pair in b): service `service` yielded `hash`. */
export const AccumulationOutput = record({ service: u32, hash });
export type AccumulationOutput = Value<typeof AccumulationOutput>;

/** Whether two outputs are the same pair: b is a set, so a pair counts once. */
const sameOutput = (x: AccumulationOutput, y: AccumulationOutput) =>
  x.service === y.service && toHex(x.hash) === toHex(y.hash);

/**
 * The root of a block's accumulation outputs (GP §7): each output encoded, E₄(s) ⌢ h,
 * then the well-balanced Merkle root of them all, with Keccak. It joins the belt (Part 9).
 */
export function outputsRoot(outputs: AccumulationOutput[]): Bytes {
  return wellBalancedRoot(outputs.map((o) => encode(AccumulationOutput, o)));
}

/**
 * P (GP §12): the preimages provided in a round reach their services. Each one a service
 * still waits for (its request is still []) is stored, and the request says it arrived at
 * `slot`, the block's. One for a service that's gone, or no longer waiting, is dropped.
 */
export function applyProvisions(
  accounts: Map<number, Account>,
  provided: Provision[],
  slot: number,
) {
  for (const { service, preimage } of provided) {
    const account = accounts.get(service);
    const hash = toHex(blake2b256(preimage));
    const length = BigInt(preimage.length);
    const waiting = account && requestOf(account, service, hash, length)?.length === 0;
    if (!waiting) continue; // gone, or not waiting for it
    setRequest(account, service, hash, length, [slot]);
    setPreimage(account, service, hash, preimage);
  }
}
