// Instructions (GP App. A): reading one instruction out of the code, its opcode and its
// arguments. What each one *does* comes in the following lessons.

import type { Program } from "./program.ts";
import { startsInstruction } from "./program.ts";

/** How an instruction's arguments are laid out after its opcode: 13 ways (GP App. A.5). */
export type Layout =
  | "none" // trap, fallthrough
  | "imm" // one immediate
  | "regExtImm" // a register and an 8-byte immediate
  | "immImm" // two immediates
  | "offset" // one jump offset
  | "regImm" // a register and an immediate
  | "regImmImm" // a register and two immediates
  | "regImmOffset" // a register, an immediate and an offset
  | "regReg" // two registers
  | "regRegImm" // two registers and an immediate
  | "regRegOffset" // two registers and an offset
  | "regRegImmImm" // two registers and two immediates
  | "regRegReg"; // three registers

/** Each layout's opcodes, which run consecutively from `first`, by their GP names. */
const LAYOUTS: { layout: Layout; first: number; names: string[] }[] = [
  { layout: "none", first: 0, names: ["trap", "fallthrough", "unlikely"] },
  { layout: "imm", first: 10, names: ["ecalli"] },
  { layout: "regExtImm", first: 20, names: ["load_imm_64"] },
  {
    layout: "immImm",
    first: 30,
    names: [
      "store_imm_u8", "store_imm_u16", "store_imm_u32", "store_imm_u64"
    ],
  },
  { layout: "offset", first: 40, names: ["jump"] },
  {
    layout: "regImm",
    first: 50,
    names: [
      "jump_ind", "load_imm", "load_u8", "load_i8", "load_u16", "load_i16", "load_u32",
      "load_i32", "load_u64", "store_u8", "store_u16", "store_u32", "store_u64"
    ],
  },
  {
    layout: "regImmImm",
    first: 70,
    names: [
      "store_imm_ind_u8", "store_imm_ind_u16", "store_imm_ind_u32", "store_imm_ind_u64"
    ],
  },
  {
    layout: "regImmOffset",
    first: 80,
    names: [
      "load_imm_jump", "branch_eq_imm", "branch_ne_imm", "branch_lt_u_imm", "branch_le_u_imm",
      "branch_ge_u_imm", "branch_gt_u_imm", "branch_lt_s_imm", "branch_le_s_imm",
      "branch_ge_s_imm", "branch_gt_s_imm"
    ],
  },
  {
    layout: "regReg",
    first: 100,
    names: [
      "move_reg", "count_set_bits_64", "count_set_bits_32", "leading_zero_bits_64",
      "leading_zero_bits_32", "trailing_zero_bits_64", "trailing_zero_bits_32", "sign_extend_8",
      "sign_extend_16", "zero_extend_16", "reverse_bytes"
    ],
  },
  {
    layout: "regRegImm",
    first: 120,
    names: [
      "store_ind_u8", "store_ind_u16", "store_ind_u32", "store_ind_u64", "load_ind_u8",
      "load_ind_i8", "load_ind_u16", "load_ind_i16", "load_ind_u32", "load_ind_i32",
      "load_ind_u64", "add_imm_32", "and_imm", "xor_imm", "or_imm", "mul_imm_32",
      "set_lt_u_imm", "set_lt_s_imm", "shlo_l_imm_32", "shlo_r_imm_32", "shar_r_imm_32",
      "neg_add_imm_32", "set_gt_u_imm", "set_gt_s_imm", "shlo_l_imm_alt_32",
      "shlo_r_imm_alt_32", "shar_r_imm_alt_32", "cmov_iz_imm", "cmov_nz_imm", "add_imm_64",
      "mul_imm_64", "shlo_l_imm_64", "shlo_r_imm_64", "shar_r_imm_64", "neg_add_imm_64",
      "shlo_l_imm_alt_64", "shlo_r_imm_alt_64", "shar_r_imm_alt_64", "rot_r_64_imm",
      "rot_r_64_imm_alt", "rot_r_32_imm", "rot_r_32_imm_alt"
    ],
  },
  {
    layout: "regRegOffset",
    first: 170,
    names: [
      "branch_eq", "branch_ne", "branch_lt_u", "branch_lt_s", "branch_ge_u", "branch_ge_s"
    ],
  },
  { layout: "regRegImmImm", first: 180, names: ["load_imm_jump_ind"] },
  {
    layout: "regRegReg",
    first: 190,
    names: [
      "add_32", "sub_32", "mul_32", "div_u_32", "div_s_32", "rem_u_32", "rem_s_32", "shlo_l_32",
      "shlo_r_32", "shar_r_32", "add_64", "sub_64", "mul_64", "div_u_64", "div_s_64",
      "rem_u_64", "rem_s_64", "shlo_l_64", "shlo_r_64", "shar_r_64", "and", "xor", "or",
      "mul_upper_s_s", "mul_upper_u_u", "mul_upper_s_u", "set_lt_u", "set_lt_s", "cmov_iz",
      "cmov_nz", "rot_l_64", "rot_l_32", "rot_r_64", "rot_r_32", "and_inv", "or_inv", "xnor",
      "max", "max_u", "min", "min_u"
    ],
  },
];

/** An opcode's name and layout, or undefined for a byte that isn't an opcode. */
export function opcodeInfo(opcode: number): { name: string; layout: Layout } | undefined {
  for (const { layout, first, names } of LAYOUTS) {
    const name = names[opcode - first];
    if (name !== undefined) return { name, layout };
  }
  return undefined;
}

/** skip(i) (GP App. A): how many bytes after the opcode at i until the next opcode, at most 24. */
export function skip(program: Program, i: number): number {
  let j = 0;
  while (j < 24 && i + 1 + j < program.code.length && !startsInstruction(program, i + 1 + j)) j++;
  return j;
}

/** n bytes of code from i, little-endian; past the end, the code reads as zeros (GP's ζ). */
function readLE(program: Program, i: number, n: number): bigint {
  let value = 0n;
  for (let k = n - 1; k >= 0; k--) value = (value << 8n) | BigInt(program.code[i + k] ?? 0);
  return value;
}

/** X_n (GP App. A): an n-byte value sign-extended to 64 bits, as an unsigned number. */
export function signExtend(n: number, x: bigint): bigint {
  if (n === 0) return 0n;
  const negative = x >> BigInt(8 * n - 1) === 1n; // the top bit of the n bytes
  return negative ? x + (2n ** 64n - 2n ** BigInt(8 * n)) : x;
}

/** Z_n (GP App. A): an n-byte value read as a signed number. */
export function signed(n: number, x: bigint): bigint {
  if (n === 0) return 0n;
  return x < 2n ** BigInt(8 * n - 1) ? x : x - 2n ** BigInt(8 * n);
}

/** One decoded instruction: what it is, and its arguments in the order the GP names them. */
export type Instruction = {
  at: number; // ı: where its opcode is
  opcode: number;
  name: string;
  layout: Layout;
  registers: number[]; // register numbers, 0 to 12
  immediates: bigint[]; // sign-extended to 64 bits
  target?: number; // where an offset points: ı plus the signed offset
  next: number; // where the next instruction starts: ı + 1 + skip(ı)
};

/** Decodes the instruction at i (GP App. A.5): its opcode, then its layout's arguments. */
export function decodeInstruction(program: Program, i: number): Instruction {
  const opcode = program.code[i];
  const info = opcodeInfo(opcode);
  if (!info) throw new Error(`no instruction has opcode ${opcode}`);
  const l = skip(program, i);
  const byte = (k: number) => program.code[i + k] ?? 0;
  const low = Math.min(12, byte(1) % 16); // a register number in the low four bits
  const high = Math.min(12, Math.floor(byte(1) / 16)); // and another in the high four
  const imm = (at: number, n: number) => signExtend(n, readLE(program, i + at, n));
  const offset = (at: number, n: number) => i + Number(signed(n, readLE(program, i + at, n)));
  const next = i + 1 + l; // ı + 1 + skip(ı)
  const result: Instruction = { at: i, opcode, ...info, registers: [], immediates: [], next };
  switch (info.layout) {
    case "none":
      break;
    case "imm":
      result.immediates = [imm(1, Math.min(4, l))];
      break;
    case "regExtImm":
      result.registers = [low];
      result.immediates = [readLE(program, i + 2, 8)];
      break;
    case "immImm": {
      const lX = Math.min(4, byte(1) % 8);
      const lY = Math.min(4, Math.max(0, l - lX - 1));
      result.immediates = [imm(2, lX), imm(2 + lX, lY)];
      break;
    }
    case "offset":
      result.target = offset(1, Math.min(4, l));
      break;
    case "regImm":
      result.registers = [low];
      result.immediates = [imm(2, Math.min(4, Math.max(0, l - 1)))];
      break;
    case "regImmImm":
    case "regImmOffset": {
      const lX = Math.min(4, Math.floor(byte(1) / 16) % 8);
      const lY = Math.min(4, Math.max(0, l - lX - 1));
      result.registers = [low];
      result.immediates = [imm(2, lX)];
      if (info.layout === "regImmImm") result.immediates.push(imm(2 + lX, lY));
      else result.target = offset(2 + lX, lY);
      break;
    }
    case "regReg":
      result.registers = [low, high]; // r_D, then r_A
      break;
    case "regRegImm":
      result.registers = [low, high];
      result.immediates = [imm(2, Math.min(4, Math.max(0, l - 1)))];
      break;
    case "regRegOffset":
      result.registers = [low, high];
      result.target = offset(2, Math.min(4, Math.max(0, l - 1)));
      break;
    case "regRegImmImm": {
      const lX = Math.min(4, byte(2) % 8);
      const lY = Math.min(4, Math.max(0, l - lX - 2));
      result.registers = [low, high];
      result.immediates = [imm(3, lX), imm(3 + lX, lY)];
      break;
    }
    case "regRegReg":
      result.registers = [low, high, Math.min(12, byte(2))]; // r_A, r_B, r_D
      break;
  }
  return result;
}
