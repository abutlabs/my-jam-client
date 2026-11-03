// Gas (GP App. A.9 and A.10): what running code costs. Every instruction has a row in the
// GP's cost table: the cycles it takes, the decode slots it needs, and the execution units
// of the virtual CPU it occupies. Lesson 15.10 feeds the rows through a model CPU.

import type { Instruction } from "./instructions.ts";
import type { Program } from "./program.ts";
import { decodeInstruction } from "./instructions.ts";
import { TERMINATORS, step } from "./machine.ts";
import type { Exit, Machine } from "./machine.ts";

/** How many of each execution unit: ALU, load, store, multiply, divide (the GP's 𝔼). */
export type Units = [number, number, number, number, number];

/** An instruction's row in the cost table: cycles (č), decode slots (ď) and units (x̌). */
export type Cost = { cycles: number; slots: number; units: Units };

const NONE: Units = [0, 0, 0, 0, 0];
const ALU: Units = [1, 0, 0, 0, 0];
const LOAD: Units = [1, 1, 0, 0, 0];
const STORE: Units = [1, 0, 1, 0, 0];
const MUL: Units = [1, 0, 0, 1, 0];
const DIV: Units = [1, 0, 0, 0, 1];

/** 𝔪 (GP App. A.10): a load or a store takes 25 cycles. */
const MEMORY = 25;

/**
 * š and ř (GP App. A.9): the registers an instruction reads, and those it writes, from its
 * row in the instruction tables. A cmov reads the register it writes: it may keep it.
 */
export function registersUsed(ins: Instruction): { reads: number[]; writes: number[] } {
  const { name, layout, registers: r } = ins;
  if (/^(store|branch|jump_ind)/.test(name)) return { reads: r, writes: [] };
  if (layout === "regRegReg") {
    return { reads: name.startsWith("cmov") ? r : r.slice(0, 2), writes: [r[2]] }; // [A, B, D]
  }
  if (layout === "regReg") return { reads: [r[1]], writes: [r[0]] }; // [D, A]
  return { reads: name.startsWith("cmov") ? r : r.slice(1), writes: r.slice(0, 1) };
}

/** What a row can depend on: the GP's 𝔓 and 𝔓_S for this instruction, and its 𝔟. */
type Context = { p: (a: number, b: number) => number; ps: (a: number, b: number) => number };
type Row = (c: Context & { b: number }) => Cost;
const cost = (cycles: number, slots: number, units: Units): Cost => ({ cycles, slots, units });
const fixed = (c: number, s: number, u: Units): Row => () => cost(c, s, u);

// The GP's kinds of row, named after its own (\simplealuthreeop and friends).
const simple: Row = ({ p }) => cost(1, p(1, 2), ALU);
const simple32: Row = ({ p }) => cost(2, p(2, 3), ALU);
const trivial = fixed(1, 1, ALU);
const trivial2 = fixed(2, 1, ALU);
const shift: Row = ({ ps }) => cost(1, ps(2, 3), ALU);
const shift32: Row = ({ ps }) => cost(2, ps(3, 4), ALU);
const shiftAlt = fixed(1, 3, ALU);
const shiftAlt32 = fixed(2, 4, ALU);
const compare = fixed(3, 3, ALU);
const minMax: Row = ({ p }) => cost(3, p(2, 3), ALU);
const divide = fixed(60, 4, DIV);

/** The rest of the GP's cost table (App. A.10); loads, stores and branches come below. */
const COSTS: Record<string, Row> = {
  move_reg: fixed(0, 1, NONE),
  and: simple, xor: simple, or: simple, add_64: simple, sub_64: simple,
  and_imm: simple, xor_imm: simple, or_imm: simple, add_imm_64: simple, shlo_r_imm_64: simple,
  shar_r_imm_64: simple, shlo_l_imm_64: simple, rot_r_64_imm: simple, reverse_bytes: simple,
  add_32: simple32, sub_32: simple32, add_imm_32: simple32, shlo_r_imm_32: simple32,
  shar_r_imm_32: simple32, shlo_l_imm_32: simple32, rot_r_32_imm: simple32,
  count_set_bits_64: trivial, count_set_bits_32: trivial, leading_zero_bits_64: trivial,
  leading_zero_bits_32: trivial, sign_extend_8: trivial, sign_extend_16: trivial,
  zero_extend_16: trivial, trailing_zero_bits_64: trivial2, trailing_zero_bits_32: trivial2,
  shlo_l_64: shift, shlo_r_64: shift, shar_r_64: shift, rot_l_64: shift, rot_r_64: shift,
  shlo_l_32: shift32, shlo_r_32: shift32, shar_r_32: shift32, rot_l_32: shift32,
  rot_r_32: shift32, shlo_l_imm_alt_64: shiftAlt, shlo_r_imm_alt_64: shiftAlt,
  shar_r_imm_alt_64: shiftAlt, rot_r_64_imm_alt: shiftAlt, shlo_l_imm_alt_32: shiftAlt32,
  shlo_r_imm_alt_32: shiftAlt32, shar_r_imm_alt_32: shiftAlt32, rot_r_32_imm_alt: shiftAlt32,
  set_lt_u: compare, set_lt_s: compare, set_lt_u_imm: compare, set_lt_s_imm: compare,
  set_gt_u_imm: compare, set_gt_s_imm: compare,
  cmov_iz: fixed(2, 2, ALU), cmov_nz: fixed(2, 2, ALU),
  cmov_iz_imm: fixed(2, 3, ALU), cmov_nz_imm: fixed(2, 3, ALU),
  max: minMax, max_u: minMax, min: minMax, min_u: minMax,
  div_u_32: divide, div_s_32: divide, rem_u_32: divide, rem_s_32: divide,
  div_u_64: divide, div_s_64: divide, rem_u_64: divide, rem_s_64: divide,
  and_inv: fixed(2, 3, ALU), or_inv: fixed(2, 3, ALU), xnor: ({ p }) => cost(2, p(2, 3), ALU),
  neg_add_imm_64: fixed(2, 3, ALU), neg_add_imm_32: fixed(3, 4, ALU),
  load_imm: fixed(1, 1, NONE), load_imm_64: fixed(1, 2, NONE),
  mul_64: ({ p }) => cost(3, p(1, 2), MUL), mul_imm_64: ({ p }) => cost(3, p(1, 2), MUL),
  mul_32: ({ p }) => cost(4, p(2, 3), MUL), mul_imm_32: ({ p }) => cost(4, p(2, 3), MUL),
  mul_upper_s_s: fixed(4, 4, MUL), mul_upper_u_u: fixed(4, 4, MUL),
  mul_upper_s_u: fixed(6, 4, MUL),
  trap: fixed(2, 1, NONE), fallthrough: fixed(2, 1, NONE), unlikely: fixed(40, 1, NONE),
  jump: fixed(15, 1, NONE), load_imm_jump: fixed(15, 1, NONE),
  jump_ind: fixed(22, 1, NONE), load_imm_jump_ind: fixed(22, 1, NONE),
  ecalli: fixed(100, 4, ALU),
};

/** An instruction's row: every load, store and branch shares one; the rest are in COSTS. */
function rowOf(name: string): Row {
  if (/^load_(ind_)?[ui]\d+$/.test(name)) return fixed(MEMORY, 1, LOAD);
  if (name.startsWith("store_")) return fixed(MEMORY, 1, STORE);
  if (name.startsWith("branch_")) return ({ b }) => cost(b, 1, ALU);
  return COSTS[name];
}

/** 𝔟 (GP App. A.10): 1 if either way a branch can go starts with unlikely or trap, else 20. */
function branchCost(program: Program, ins: Instruction): number {
  const opcodeAt = (i: number) => program.code[i] ?? 0; // past the end, ζ is zeros: trap
  const ways = [ins.next, ins.target as number]; // fall through, or jump
  return ways.some((i) => [0, 2].includes(opcodeAt(i))) ? 1 : 20;
}

/** An instruction's cost (GP App. A.10): its row, for its registers and its branch targets. */
export function instructionCost(program: Program, ins: Instruction): Cost {
  const { reads, writes } = registersUsed(ins);
  const overlap = writes.some((r) => reads.includes(r));
  const [a, , d] = ins.registers; // for the shifts: registers [A, B, D]
  const p = (x: number, y: number) => (overlap ? x : y); // 𝔓: writes a register it reads?
  const ps = (x: number, y: number) => (a === d ? x : y); // 𝔓_S: is φ_D the same as φ_A?
  const b = ins.name.startsWith("branch_") ? branchCost(program, ins) : 0;
  return rowOf(ins.name)({ p, ps, b });
}

/** A reorder buffer entry's state: decoding, waiting, executing, finished, or retired. */
type State = "DEC" | "WAIT" | "EXE" | "FIN" | null;

/** An instruction in the reorder buffer (GP's ℝ): its state, cycles to go, what it waits on. */
type Entry = { state: State; cycles: number; deps: number[]; regs: number[]; units: Units };

/**
 * The model CPU (GP's 𝕊): where it's decoding, its clock, what's left this cycle, and the
 * reorder buffer, where decoded instructions wait, run and retire.
 */
export type Cpu = {
  pc: number | null; // ı: the next instruction to decode, or null once the block is decoded
  cycles: number; // c
  decode: number; // d: decode slots left this cycle
  start: number; // e: instructions that may still start this cycle
  units: Units; // t: execution units free
  rob: Entry[]; // r
};

/** Units added up, kind by kind (or taken away, with a sign of −1). */
const plus = (a: Units, b: Units, sign = 1) => a.map((u, k) => u + sign * b[k]) as Units;

/** S (GP App. A.9): the first waiting instruction whose units are free and inputs ready. */
function readyToStart(cpu: Cpu): number | null {
  const ready = cpu.rob.findIndex(
    (e) =>
      e.state === "WAIT" &&
      e.units.every((u, k) => u <= cpu.units[k]) &&
      e.deps.every((k) => cpu.rob[k].cycles === 0),
  );
  return ready === -1 ? null : ready;
}

/** X′ (GP App. A.9): decodes one instruction into the reorder buffer. */
function decode(cpu: Cpu, program: Program, ins: Instruction): void {
  const { reads, writes } = registersUsed(ins);
  if (ins.name === "move_reg") {
    // X^mov: no work at all. Whatever makes the register it reads now makes its destination.
    for (const e of cpu.rob) {
      const feeds = e.regs.some((r) => reads.includes(r));
      e.regs = feeds ? [...e.regs, ...writes] : e.regs.filter((r) => !writes.includes(r));
    }
    cpu.pc = ins.next;
    cpu.decode -= 1;
    return;
  }
  // X^dec: it waits on every entry that makes a register it reads.
  const { cycles, slots, units } = instructionCost(program, ins);
  const deps = cpu.rob.flatMap((e, i) => (e.regs.some((r) => reads.includes(r)) ? [i] : []));
  for (const e of cpu.rob) e.regs = e.regs.filter((r) => !writes.includes(r));
  cpu.rob.push({ state: "DEC", cycles, deps, regs: writes, units });
  cpu.pc = TERMINATORS.has(ins.opcode) ? null : ins.next;
  cpu.decode -= slots;
}

/** X″ (GP App. A.9): starts the first instruction that's ready. */
function startOne(cpu: Cpu, n: number): void {
  cpu.start -= 1;
  cpu.units = plus(cpu.units, cpu.rob[n].units, -1);
  cpu.rob[n].state = "EXE";
}

/** X‴ (GP App. A.9): one tick of the clock. */
function tick(cpu: Cpu): void {
  cpu.cycles += 1;
  cpu.decode = 4;
  cpu.start = 5;
  let retiring = true; // has everything up to here finished? Then it retires, in order
  for (const e of cpu.rob) {
    retiring &&= e.state === "FIN" || e.state === null;
    const executing = e.state === "EXE";
    if (executing && e.cycles === 1) cpu.units = plus(cpu.units, e.units); // done: units free
    if (retiring) e.state = null;
    else if (e.state === "DEC") e.state = "WAIT";
    else if (executing && e.cycles === 0) e.state = "FIN";
    if (executing && e.cycles > 0) e.cycles -= 1;
  }
}

/**
 * ϱ^Δ (GP App. A.9): the gas a basic block costs. The model CPU decodes up to 4 slots and
 * starts up to 5 instructions a cycle, runs them on (4, 4, 4, 1, 1) units, and retires
 * them in order. The cost is its cycles until all are retired, less 3, and at least 1.
 * `watch`, if given, sees the CPU after every tick.
 */
export function blockCost(program: Program, start: number, watch?: (cpu: Cpu) => void): number {
  const cpu: Cpu = { pc: start, cycles: 0, decode: 4, start: 5, units: [4, 4, 4, 1, 1], rob: [] };
  for (;;) {
    const live = cpu.rob.filter((e) => e.state !== null).length;
    const ins = cpu.pc === null ? null : decodeInstruction(program, cpu.pc);
    const ready = readyToStart(cpu);
    if (ins && instructionCost(program, ins).slots <= cpu.decode && live < 32) {
      decode(cpu, program, ins);
    } else if (ready !== null && cpu.start > 0) {
      startOne(cpu, ready);
    } else if (cpu.pc === null && live === 0) {
      return Math.max(cpu.cycles - 3, 1);
    } else {
      tick(cpu);
      watch?.(cpu); // lets a watcher see each cycle
    }
  }
}

/**
 * Ψ₁ with gas (GP App. A.4). A basic block is paid for in full on the way in, before any
 * of it runs. Without the gas for it, the machine stops "oog" (out of gas), as it was.
 */
export function stepWithGas(m: Machine): Exit {
  if (!m.charged) {
    const cost = BigInt(blockCost(m.program, m.pc));
    if (m.gas < cost) return "oog";
    m.gas -= cost;
    m.charged = true;
  }
  const opcode = m.program.code[m.pc];
  const exit = step(m);
  if (exit === "continue" && TERMINATORS.has(opcode)) m.charged = false; // a new block next
  return exit;
}

/** Ψ with gas: steps until the machine stops, or its gas runs out. */
export function runWithGas(m: Machine): Exit {
  for (;;) {
    const exit = stepWithGas(m);
    if (exit !== "continue") return exit;
  }
}
