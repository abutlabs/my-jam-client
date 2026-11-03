// Block import (GP §4): the state transition Υ, one block at a time. This file starts with
// its plan: every new piece of state, what it's made from, and an order to make them in.

import type { Config } from "./config.ts";
import type { Block } from "./block.ts";
import type { KeyValue } from "./trie.ts";
import { readState, writeState } from "./whole-state.ts";
import { accumulateBlock, outputsRoot } from "./accumulate.ts";
import { providePreimages } from "./services.ts";
import { toHex, fromHex } from "./bytes.ts";
import { extrinsicHash, EpochMark, TicketBody, headerHash } from "./block.ts";
import { stateRoot } from "./trie.ts";
import type { State } from "./whole-state.ts";
import type { Bytes } from "./bytes.ts";
import { disputesError, judges, outcome, recordVerdicts, recordOffenders, clearJudged, offendersMark } from "./disputes.ts";
import type { Safrole } from "./safrole.ts";
import { safroleError, safroleStep, sealError } from "./safrole.ts";
import { vrfOutput } from "./bandersnatch.ts";
import { encode, fixedBytes, option, seq, seqN, decode } from "./codec/codec.ts";
import type { Codec } from "./codec/codec.ts";
import { assuranceError, availableCores, nowAvailable, clearCores } from "./assurances.ts";
import type { PendingReport } from "./cores.ts";
import { placeReports, reportedPackages } from "./cores.ts";
import { ValidatorKey } from "./state.ts";
import { guarantorAssignments, guaranteeError, reportError } from "./guarantors.ts";
import type { ServiceNeeds } from "./guarantors.ts";
import type { AccumulationState } from "./accumulate.ts";
import { recordBlock } from "./history.ts";
import { nextPools, usedAuthorizers } from "./authorization.ts";
import { updateValidatorStats, coreStats, serviceStats } from "./statistics.ts";
import type { PastJudgements } from "./disputes.ts";
import type { WorkReport } from "./work.ts";
import type { AncestryItem } from "./fuzz.ts";

/**
 * One step of Υ (GP §4.2): the values it makes, the values it's made from, and the lesson
 * that builds it. A prime (′) is a value after the block, a dagger (†, ‡) a value halfway
 * through it; H and the E_ are the block's header and extrinsic parts; the rest is the
 * state before the block.
 */
export type Step = { makes: string[]; from: string[]; lesson: string };

/** The Gray Paper's dependency graph (§4.2, equation transitionfunctioncomposition), in the
 * order it lists the steps. */
export const STEPS: Step[] = [
  { makes: ["τ′"], from: ["H"], lesson: "4.6" },
  { makes: ["β_H†"], from: ["H", "β_H"], lesson: "9.2" },
  { makes: ["γ′"], from: ["H", "τ", "E_T", "γ", "ι", "η′", "κ′", "ψ′"], lesson: "8.5" },
  { makes: ["η′"], from: ["H", "τ", "η"], lesson: "8.1" },
  { makes: ["κ′"], from: ["H", "τ", "κ", "γ"], lesson: "8.2" },
  { makes: ["λ′"], from: ["H", "τ", "λ", "κ"], lesson: "8.2" },
  { makes: ["ψ′"], from: ["E_D", "ψ"], lesson: "10.1, 10.2" },
  { makes: ["ρ†"], from: ["E_D", "ρ"], lesson: "10.3" },
  { makes: ["ρ‡"], from: ["E_A", "ρ†"], lesson: "11.2" },
  { makes: ["ρ′"], from: ["E_G", "ρ‡", "κ", "τ′"], lesson: "12.3" },
  { makes: ["𝐑*"], from: ["E_A", "ρ†"], lesson: "11.1, 17.2" },
  {
    makes: ["ω′", "ξ′", "δ‡", "χ′", "ι′", "ϕ′", "θ′", "𝐒"],
    from: ["𝐑*", "ω", "ξ", "δ", "χ", "ι", "ϕ", "τ", "τ′"],
    lesson: "17",
  },
  { makes: ["β_H′"], from: ["H", "E_G", "β_H†", "θ′"], lesson: "9.2" },
  { makes: ["δ′"], from: ["E_P", "δ‡", "τ′"], lesson: "14.1" },
  { makes: ["α′"], from: ["H", "E_G", "ϕ′", "α"], lesson: "13.1" },
  {
    makes: ["π′"],
    from: ["E_G", "E_P", "E_A", "E_T", "τ", "κ′", "π", "H", "𝐒"],
    lesson: "18",
  },
];

/**
 * The steps in waves: first every step made only from the block and the state before it,
 * then every step whose inputs the first wave made, and so on. Steps in one wave don't
 * need each other, so a client could run them side by side. Throws if some steps can
 * never run because they wait for each other.
 */
export function waves(steps: Step[]): Step[][] {
  const madeByAStep = new Set(steps.flatMap((s) => s.makes));
  const made = new Set<string>();
  const ready = (s: Step) => s.from.every((x) => made.has(x) || !madeByAStep.has(x));
  const out: Step[][] = [];
  let left = steps;
  while (left.length > 0) {
    const wave = left.filter(ready);
    if (wave.length === 0) throw new Error("these steps wait for each other");
    out.push(wave);
    for (const step of wave) for (const x of step.makes) made.add(x);
    left = left.filter((s) => !wave.includes(s));
  }
  return out;
}

/** A block refused: the rule it breaks, as the test vectors name it. */
export type Refused = { error: string };

/**
 * Υ (GP §4): imports a block into a state, given as its entries. The state after the
 * block, as entries; or why the block is refused, and then the state stays as it was.
 * The steps are the earlier parts', each after everything it needs (lesson 19.1's waves).
 */
export function importBlock(
  config: Config,
  entries: KeyValue[],
  block: Block,
  ancestry?: AncestryItem[], // the last L blocks, when the importer keeps them (lesson 20.2)
): KeyValue[] | Refused {
  const state = readState(config, entries);
  const headerProblem = checkHeader(config, state, entries, block);
  if (headerProblem) return { error: headerProblem };
  const judged = judgeDisputes(config, state, block); // ψ′, ρ†
  if (refused(judged)) return judged;
  const sealed = runSafrole(config, state, block, judged.judgements.offenders); // γ′, η′, κ′...
  if (refused(sealed)) return sealed;
  const assured = takeAssurances(state, block, judged.cores, sealed.validators.active); // 𝐑, ρ‡
  if (refused(assured)) return assured;
  const offenders = judged.judgements.offenders; // ψ′_O
  const guaranteed = takeGuarantees(config, state, block, assured.cores, sealed, offenders); // ρ′
  if (refused(guaranteed)) return guaranteed;
  const anchorProblem = anchorError(config, guaranteed.reports, block.header.slot, ancestry);
  if (anchorProblem) return { error: anchorProblem };
  const slot = block.header.slot; // τ′
  const accumulation = accumulateBlock(
    config, accumulationState(state, sealed.entropy[0]), slot, assured.reports,
  );
  const after = nextState(config, state, block, {
    judgements: judged.judgements, sealed, assured, guaranteed, accumulation,
  });
  return providePreimages(writeState(config, after), block.extrinsic.preimages, slot); // δ′
}

/** Whether a step refused the block. */
const refused = (x: object): x is Refused => "error" in x;

/**
 * The header's own checks (GP §5): its parent is the newest block the state remembers, the
 * state root before it is the state's, its slot is after the parent's and its extrinsic
 * hash is its extrinsic's.
 */
export function checkHeader(
  config: Config,
  state: State,
  entries: KeyValue[],
  block: Block,
): string | null {
  const { header, extrinsic } = block;
  const parent = state[3].history.at(-1);
  if (parent && toHex(parent.header_hash) !== toHex(header.parent)) return "bad_parent";
  if (toHex(stateRoot(entries)) !== toHex(header.parent_state_root)) return "bad_parent_state_root";
  if (header.slot <= state[11]) return "bad_slot";
  if (toHex(extrinsicHash(config, extrinsic)) !== toHex(header.extrinsic_hash)) {
    return "bad_extrinsic_hash";
  }
  return null;
}

/** ψ′ and ρ† (Part 10): the block's disputes judged, and the cores without the reports
 * found bad or wonky. */
function judgeDisputes(config: Config, state: State, block: Block) {
  const disputes = block.extrinsic.disputes;
  const [time, active, previous] = [state[11], state[8], state[9]];
  const error = disputesError(config, disputes, state[5], time, active, previous);
  if (error) return { error };
  const judged = disputes.verdicts.map((v) => {
    const voters = judges(config, time, v.age, active, previous).length;
    return { target: v.target, outcome: outcome(v, voters) };
  });
  const judgements = recordOffenders(recordVerdicts(state[5], judged), disputes); // ψ′
  return { judgements, cores: clearJudged(state[10], judged) };
}

/** Safrole (Part 8): η′, the validators and γ′ after the block, once its tickets, its
 * header's marks and its seal all check out. */
function runSafrole(config: Config, state: State, block: Block, offenders: Bytes[]) {
  const { header, extrinsic } = block;
  const before: Safrole = {
    time: state[11],
    entropy: state[6],
    validators: {
      staging: state[7], pending: state[4].pending, active: state[8], previous: state[9],
    },
    accumulator: state[4].accumulator,
    sealers: state[4].sealers,
    ringRoot: state[4].ring_root,
  };
  const error = safroleError(config, before, header.slot, extrinsic.tickets, offenders);
  if (error) return { error };
  const output = vrfOutput(header.entropy_source);
  const step = safroleStep(config, before, header.slot, output, offenders, extrinsic.tickets);
  if (!sameValue(option(EpochMark), header.epoch_mark, step.epochMark)) {
    return { error: "bad_epoch_mark" };
  }
  const marks = option(seqN(TicketBody, config.epoch_length));
  if (!sameValue(marks, header.tickets_mark, step.ticketsMark)) {
    return { error: "bad_tickets_mark" };
  }
  const convicted = offendersMark(extrinsic.disputes);
  if (!sameValue(seq(fixedBytes(32)), header.offenders_mark, convicted)) {
    return { error: "bad_offenders_mark" };
  }
  const after = step.after;
  const author = after.validators.active[header.author_index]?.bandersnatch;
  if (!author) return { error: "bad_validator_index" };
  const sealProblem = sealError(config, header, author, after.sealers, after.entropy[3]);
  return sealProblem ? { error: sealProblem } : after;
}

/** Whether two values encode to the same bytes: how a header's marks are compared. */
function sameValue<T>(codec: Codec<T>, x: T, y: T): boolean {
  return toHex(encode(codec, x)) === toHex(encode(codec, y));
}

/** The assurances (Part 11): the reports that became available, 𝐑, and the cores
 * without them, or the ones that timed out, ρ‡. */
function takeAssurances(
  state: State,
  block: Block,
  cores: (PendingReport | null)[], // ρ†
  validators: ValidatorKey[], // κ′
) {
  const assurances = block.extrinsic.assurances;
  const keys = state[8].map((k) => k.ed25519);
  const error = assuranceError(assurances, block.header.parent, keys, cores);
  if (error) return { error };
  const available = availableCores(cores, assurances, state[8].length);
  const reports = nowAvailable(cores, assurances, state[8].length); // 𝐑
  const resized = state[8].length !== validators.length;
  return { reports, cores: clearCores(cores, available, block.header.slot, resized) };
}

/** The guarantees (Part 12): checked against the cores, the guarantors and the recent
 * history, then their reports take their cores, ρ′. */
function takeGuarantees(
  config: Config,
  state: State,
  block: Block,
  cores: (PendingReport | null)[], // ρ‡
  sealed: Safrole, // for η′, κ′ and λ′
  offenders: Bytes[], // ψ′_O
) {
  const { guarantees } = block.extrinsic;
  const { slot } = block.header;
  const { entropy, validators } = sealed;
  const assignments = guarantorAssignments(
    config, slot, entropy, validators.active, validators.previous, offenders,
  );
  const count = validators.active.length;
  const error = guaranteeError(config, guarantees, slot, assignments, cores, state[1], count);
  if (error) return { error };
  const reports = guarantees.map((g) => g.report); // 𝐈
  const history = state[3].history.map((b, i, all) => // β†: the newest block's root, known now
    i === all.length - 1 ? { ...b, state_root: block.header.parent_state_root } : b,
  );
  const problem = reportError(reports, history, pipeline(state), services(state));
  if (problem) return { error: problem };
  return { cores: placeReports(cores, guarantees, slot), reports };
}

/** The packages already on their way through (GP §11): accumulated recently, waiting in
 * the ready queue, or pending on a core. None of them may be reported again. */
function pipeline(state: State): Set<string> {
  const accumulated = state[15].flat().map(toHex);
  const waiting = state[14].flat().map((w) => toHex(w.report.package_spec.hash));
  const pending = state[10].flatMap((p) => (p ? [p.guarantee.report.package_spec.hash] : []));
  return new Set([...accumulated, ...waiting, ...pending.map(toHex)]);
}

/** What the guarantee checks need of each service: its code hash and least item gas. */
function services(state: State): Map<number, ServiceNeeds> {
  return new Map([...state.accounts].map(([s, a]) => [s, a.info]));
}

/** The state accumulation reads (lesson 17.2), from the whole state, and η′₀. */
function accumulationState(state: State, entropy: Bytes): AccumulationState {
  const privileges = state[12];
  return {
    slot: state[11],
    accounts: state.accounts,
    free: new Map(privileges.always_acc.map((x) => [x.id, x.gas])),
    privileges: {
      bless: privileges.bless,
      assign: privileges.assign,
      designate: privileges.designate,
      register: privileges.register,
    },
    entropy,
    ready: state[14].map((slot) =>
      slot.map((w) => ({ report: w.report, dependencies: new Set(w.dependencies.map(toHex)) })),
    ),
    accumulated: state[15].map((packages) => new Set(packages.map(toHex))),
  };
}

/** What the steps made, for the state after the block. */
type Made = {
  judgements: PastJudgements; // ψ′
  sealed: Safrole;
  assured: { reports: WorkReport[] };
  guaranteed: { cores: (PendingReport | null)[]; reports: WorkReport[] };
  accumulation: ReturnType<typeof accumulateBlock>;
};

/** σ′ but for δ′'s preimages: every component after the block, from what the steps made,
 * and β′, α′ and π′, which come last. */
function nextState(config: Config, state: State, block: Block, made: Made): State {
  const { header, extrinsic } = block;
  const { sealed, accumulation } = made;
  const after = accumulation.state;
  const recent = recordBlock(state[3], {
    header_hash: headerHash(config, header),
    parent_state_root: header.parent_state_root,
    accumulate_root: outputsRoot(accumulation.outputs),
    slot: header.slot,
    work_packages: reportedPackages(extrinsic.guarantees),
  }); // β′
  const queues = state[2].map((q, c) => accumulation.queues.get(c) ?? q); // ϕ′
  const used = usedAuthorizers(extrinsic.guarantees);
  const statsBefore = { slot: state[11], current: state[13].vals_curr, last: state[13].vals_last };
  const validatorStats = updateValidatorStats(
    config, statsBefore, header.slot, header.author_index, extrinsic, sealed.validators.active,
  );
  const incoming = made.guaranteed.reports;
  const activity = serviceStats(incoming, extrinsic.preimages, accumulation.statistics);
  const byId = <T>(m: Map<number, T>) => [...m].sort(([x], [y]) => x - y);
  const staging = accumulation.staging?.map((k) => decode(ValidatorKey, k)); // ι′, if chosen
  return {
    ...state,
    1: nextPools(state[1], queues, used, header.slot), // α′
    2: queues,
    3: recent,
    4: {
      pending: sealed.validators.pending,
      ring_root: sealed.ringRoot,
      sealers: sealed.sealers,
      accumulator: sealed.accumulator,
    },
    5: made.judgements,
    6: sealed.entropy,
    7: staging ?? sealed.validators.staging,
    8: sealed.validators.active,
    9: sealed.validators.previous,
    10: made.guaranteed.cores,
    11: header.slot,
    12: {
      ...after.privileges,
      always_acc: byId(after.free).map(([id, gas]) => ({ id, gas })),
    },
    13: {
      vals_curr: validatorStats.current,
      vals_last: validatorStats.last,
      cores: coreStats(config, incoming, made.assured.reports, extrinsic.assurances),
      services: byId(activity).map(([id, record]) => ({ id, record })),
    },
    14: after.ready.map((waiting) =>
      waiting.map((w) => ({ report: w.report, dependencies: [...w.dependencies].map(fromHex) })),
    ),
    15: after.accumulated.map((packages) => [...packages].sort().map(fromHex)), // sorted sets
    16: accumulation.outputs,
    accounts: after.accounts,
  };
}

/**
 * The lookup anchors (GP §11): each report's lookup anchor is at most L slots old, and,
 * when the importer keeps the last L blocks, one of them, by its hash and its slot.
 */
function anchorError(
  config: Config,
  reports: WorkReport[],
  slot: number, // H_T
  ancestry?: AncestryItem[],
): string | null {
  const known = new Map(ancestry?.map((a) => [toHex(a.header_hash), a.slot]));
  for (const { context } of reports) {
    if (context.lookup_anchor_slot < slot - config.max_lookup_anchor_age) {
      return "lookup_anchor_too_old";
    }
    if (ancestry && known.get(toHex(context.lookup_anchor)) !== context.lookup_anchor_slot) {
      return "lookup_anchor_unknown";
    }
  }
  return null;
}
