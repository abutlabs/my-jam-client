// The machine (GP App. A): thirteen 64-bit registers and an instruction counter, stepping
// through a program one instruction at a time. Memory and gas come in later lessons.

import type { Instruction } from "./instructions.ts";
import { decodeInstruction, opcodeInfo, skip, signExtend, signed } from "./instructions.ts";
import type { Program } from "./program.ts";
import { startsInstruction } from "./program.ts";
import type { Memory, MemoryError } from "./memory.ts";
import { readMemory, writeMemory } from "./memory.ts";
import { decodeFixed, encodeFixed } from "../codec/numbers.ts";
import { OPERATIONS, operationOf } from "./arithmetic.ts";
import { BIT_OPERATIONS } from "./bits.ts";

/** How a step ends (GP's ε): carry on, finish, fail, run out of gas, fault, or call the host. */
export type Exit = "continue" | "halt" | "panic" | "oog" | { fault: number } | { host: number };

/** The machine's state: the program, ı, the registers φ, the memory μ, and its gas. */
export type Machine = {
  program: Program;
  pc: number;
  registers: bigint[];
  memory: Memory;
  blocks: Set<number>;
  gas: bigint; // ϱ: what's left to spend
  charged: boolean; // has the basic block it's in been paid for?
};

/** T (GP App. A.3): the instructions that end a basic block. */
export const TERMINATORS = new Set([0, 1, 40, 50, 80, 180, 170, 171, 172, 173, 174, 175]);
for (let opcode = 81; opcode <= 90; opcode++) TERMINATORS.add(opcode); // the immediate branches

/** ϖ (GP App. A.3): where basic blocks start, at 0 and just after every terminator. */
export function basicBlocks(program: Program): Set<number> {
  const starts = new Set<number>([0]);
  for (let i = 0; i < program.code.length; i++) {
    if (startsInstruction(program, i) && TERMINATORS.has(program.code[i])) {
      starts.add(i + 1 + skip(program, i));
    }
  }
  const valid = (n: number) => startsInstruction(program, n) && !!opcodeInfo(program.code[n]);
  return new Set([...starts].filter(valid));
}

/** A machine at instruction 0: every register 0, no memory and no gas, unless given. */
export function newMachine(
  program: Program,
  registers: bigint[] = [],
  memory: Memory = new Map(),
  gas = 0n,
): Machine {
  const all = Array.from({ length: 13 }, (_, i) => registers[i] ?? 0n);
  const blocks = basicBlocks(program);
  return { program, pc: 0, registers: all, memory, blocks, gas, charged: false };
}

/** The address that halts the machine when jumped to: where r0 points at the start. */
export const HALT_ADDRESS = 2n ** 32n - 2n ** 16n;

/** Moves to b, which must start a basic block (sjump). */
function jumpTo(m: Machine, b: number): Exit {
  if (!m.blocks.has(b)) return "panic";
  m.pc = b;
  return "continue";
}

/** A branch to b if `taken`: both b and the next instruction must start basic blocks. */
function branch(m: Machine, ins: Instruction, b: number, taken: boolean): Exit {
  if (!m.blocks.has(b) || !m.blocks.has(ins.next)) return "panic";
  m.pc = taken ? b : ins.next;
  return "continue";
}

/** djump(a): through the jump table, by address a = (index + 1) · 2; HALT_ADDRESS halts. */
function jumpIndirect(m: Machine, a: bigint): Exit {
  if (a === HALT_ADDRESS) return "halt";
  const table = m.program.jumpTable;
  if (a === 0n || a > BigInt(table.length * 2) || a % 2n !== 0n) return "panic";
  return jumpTo(m, table[Number(a / 2n) - 1]);
}

/** Lesson 15.3's instructions: jumps, and loading and moving values. */
function basics(m: Machine, ins: Instruction): Exit | undefined {
  const [a, b] = ins.registers; // the GP's register letters, in its order
  const [x] = ins.immediates;
  const reg = m.registers; // φ
  switch (ins.name) {
    case "trap":
      return "panic";
    case "fallthrough":
      return jumpTo(m, ins.next);
    case "jump":
      return jumpTo(m, ins.target as number);
    case "jump_ind":
      return jumpIndirect(m, (reg[a] + x) % 2n ** 32n);
    case "load_imm":
    case "load_imm_64":
      reg[a] = x;
      return "continue";
    case "move_reg": // registers [D, A]: φ′_D = φ_A
      reg[a] = reg[b];
      return "continue";
    default:
      return undefined; // not one of these
  }
}

/** A family of instructions: runs the instruction if it's one of its own, else undefined. */
type Family = (m: Machine, ins: Instruction) => Exit | undefined;

/** Every family of instructions built so far. */
const FAMILIES: Family[] = [
  basics,
  memoryInstructions,
  arithmetic,
  decisions,
  bitsAndBytes,
  hostCall,
];

/** Ψ₁ (GP App. A.4): runs the instruction at ı. Each family has a go at it. */
export function step(m: Machine): Exit {
  const ins = decodeInstruction(m.program, m.pc);
  m.pc = ins.next; // most instructions just move on
  for (const family of FAMILIES) {
    const exit = family(m, ins);
    if (exit !== undefined) return exit;
  }
  throw new Error(`${ins.name} isn't built yet`);
}

/** Ψ, without gas yet: steps until the machine halts, panics, faults or calls the host. */
export function run(m: Machine): Exit {
  for (;;) {
    const exit = step(m);
    if (exit !== "continue") return exit;
  }
}

/** A memory error leaves the machine as it was, at the instruction that caused it. */
function failed(m: Machine, ins: Instruction, error: MemoryError): Exit {
  m.pc = ins.at;
  return error;
}

/** Lesson 15.4's instructions: loads and stores, in every width and form. */
function memoryInstructions(m: Machine, ins: Instruction): Exit | undefined {
  const [a, b] = ins.registers;
  const [x, y] = ins.immediates;
  const reg = m.registers;
  const load = /^load_(ind_)?([ui])(8|16|32|64)$/.exec(ins.name);
  if (load) {
    const [, indirect, kind, bits] = load;
    const n = Number(bits) / 8;
    const bytes = readMemory(m.memory, indirect ? reg[b] + x : x, n);
    if (!(bytes instanceof Uint8Array)) return failed(m, ins, bytes);
    const value = decodeFixed(bytes); // little-endian
    reg[a] = kind === "i" ? signExtend(n, value) : value; // load_i… sign-extends
    return "continue";
  }
  const store = /^store_(imm_)?(ind_)?u(8|16|32|64)$/.exec(ins.name);
  if (store) {
    const [, imm, indirect, bits] = store;
    const n = Number(bits) / 8;
    const value = imm ? y : reg[a]; // store_imm… stores an immediate, the others φ_A
    const base = !indirect ? 0n : imm ? reg[a] : reg[b]; // …_ind adds a register
    const bytes = encodeFixed(value % 2n ** BigInt(8 * n), n);
    const error = writeMemory(m.memory, base + x, bytes);
    return error ? failed(m, ins, error) : "continue";
  }
  return undefined;
}

/** Lesson 15.5's instructions: arithmetic and logic, with an immediate or three registers. */
function arithmetic(m: Machine, ins: Instruction): Exit | undefined {
  const { operation, swapped } = operationOf(ins.name);
  const f = OPERATIONS[operation];
  if (!f) return undefined;
  const [a, b, d] = ins.registers;
  const [x] = ins.immediates;
  const reg = m.registers;
  if (ins.layout === "regRegImm") {
    const [p, q] = swapped ? [x, reg[b]] : [reg[b], x]; // φ′_A from φ_B and ν_X
    reg[a] = f(p, q, reg[a]);
  } else {
    reg[d] = f(reg[a], reg[b], reg[d]); // three registers: φ′_D from φ_A and φ_B
  }
  return "continue";
}

/** How a branch compares φ_A with φ_B or ν_X: as unsigned numbers (u), or signed (s, Z₈). */
const COMPARISONS: Record<string, (p: bigint, q: bigint) => boolean> = {
  eq: (p, q) => p === q,
  ne: (p, q) => p !== q,
  lt_u: (p, q) => p < q,
  le_u: (p, q) => p <= q,
  ge_u: (p, q) => p >= q,
  gt_u: (p, q) => p > q,
  lt_s: (p, q) => signed(8, p) < signed(8, q),
  le_s: (p, q) => signed(8, p) <= signed(8, q),
  ge_s: (p, q) => signed(8, p) >= signed(8, q),
  gt_s: (p, q) => signed(8, p) > signed(8, q),
};

/** Lesson 15.6's instructions: every branch, the jumps that load a register, and unlikely. */
function decisions(m: Machine, ins: Instruction): Exit | undefined {
  const [a, b] = ins.registers;
  const [x, y] = ins.immediates;
  const reg = m.registers;
  if (ins.name.startsWith("branch_")) {
    const comparison = ins.name.slice("branch_".length).replace("_imm", "");
    const q = ins.name.endsWith("_imm") ? x : reg[b]; // φ_A against ν_X, or against φ_B
    return branch(m, ins, ins.target as number, COMPARISONS[comparison](reg[a], q));
  }
  switch (ins.name) {
    case "load_imm_jump": // φ′_A = ν_X, and jump to ν_Y
      reg[a] = x;
      return jumpTo(m, ins.target as number);
    case "load_imm_jump_ind": {
      const address = (reg[b] + y) % 2n ** 32n; // from φ_B as it was, before φ_A changes
      reg[a] = x;
      return jumpIndirect(m, address);
    }
    case "unlikely": // does nothing at all; it's a hint for the gas meter
      return "continue";
    default:
      return undefined;
  }
}

/** Lesson 15.7's instructions: φ′_D from φ_A alone, by counting, widening or reversing. */
function bitsAndBytes(m: Machine, ins: Instruction): Exit | undefined {
  const f = BIT_OPERATIONS[ins.name];
  if (!f) return undefined;
  const [d, a] = ins.registers; // two registers: [D, A]
  m.registers[d] = f(m.registers[a]);
  return "continue";
}

/** Lesson 15.8's instruction: ecalli stops the machine, to ask the host for something. */
function hostCall(m: Machine, ins: Instruction): Exit | undefined {
  if (ins.name !== "ecalli") return undefined;
  m.pc = ins.at; // ı stays on the ecalli; the host moves it on once it has answered
  return { host: Number(ins.immediates[0]) };
}
