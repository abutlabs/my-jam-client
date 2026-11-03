// Arithmetic and logic (GP App. A.5): every instruction that takes two numbers and makes a
// third, in 32 and 64 bits. One line each, straight from the GP's tables.

import { signed, signExtend } from "./instructions.ts";

const M32 = 2n ** 32n;
const M64 = 2n ** 64n;

/** x mod n, always from 0 to n − 1 (bigint's % keeps the sign of x). */
const mod = (x: bigint, n: bigint) => ((x % n) + n) % n;
/** A 32-bit result, sign-extended to 64 bits (GP's X₄). */
const ext32 = (x: bigint) => signExtend(4, mod(x, M32));
/** A register's low 32 bits, read as signed (Z₄), and the whole register (Z₈). */
const s32 = (x: bigint) => signed(4, mod(x, M32));
const s64 = (x: bigint) => signed(8, x);
/** A signed number back into 64 bits (Z₈⁻¹). */
const u64 = (x: bigint) => mod(x, M64);
const bool = (b: boolean) => (b ? 1n : 0n);
/** Rotations: x's bits moved k places round a word of n bits. */
const rotateRight = (x: bigint, k: bigint, n: bigint) =>
  mod((x >> k) | (x << (n - k)), 2n ** n);

/**
 * Each operation, by its three-register name: p and q are its two inputs (φ_A and φ_B,
 * or φ_B and ν_X for the immediate forms), and `old` the register being written.
 */
export const OPERATIONS: Record<string, (p: bigint, q: bigint, old: bigint) => bigint> = {
  add_32: (p, q) => ext32(p + q),
  sub_32: (p, q) => ext32(p + M32 - mod(q, M32)),
  mul_32: (p, q) => ext32(p * q),
  div_u_32: (p, q) => (mod(q, M32) === 0n ? M64 - 1n : ext32(mod(p, M32) / mod(q, M32))),
  div_s_32: (p, q) => {
    const [a, b] = [s32(p), s32(q)];
    if (b === 0n) return M64 - 1n;
    if (a === -(2n ** 31n) && b === -1n) return u64(a); // the one quotient that won't fit
    return u64(a / b); // bigint's / rounds towards zero, like the GP's rtz
  },
  rem_u_32: (p, q) => (mod(q, M32) === 0n ? ext32(p) : ext32(mod(p, M32) % mod(q, M32))),
  rem_s_32: (p, q) => {
    const [a, b] = [s32(p), s32(q)];
    if (a === -(2n ** 31n) && b === -1n) return 0n;
    return u64(b === 0n ? a : a % b); // % keeps a's sign, like the GP's smod
  },
  shlo_l_32: (p, q) => ext32(p << mod(q, 32n)),
  shlo_r_32: (p, q) => ext32(mod(p, M32) >> mod(q, 32n)),
  shar_r_32: (p, q) => u64(s32(p) >> mod(q, 32n)), // >> on a negative rounds down: arithmetic
  neg_add_32: (p, q) => ext32(q + M32 - p),
  rot_l_32: (p, q) => ext32(rotateRight(mod(p, M32), 32n - mod(q, 32n), 32n)),
  rot_r_32: (p, q) => ext32(rotateRight(mod(p, M32), mod(q, 32n), 32n)),
  add_64: (p, q) => mod(p + q, M64),
  sub_64: (p, q) => mod(p - q, M64),
  mul_64: (p, q) => mod(p * q, M64),
  div_u_64: (p, q) => (q === 0n ? M64 - 1n : p / q),
  div_s_64: (p, q) => {
    const [a, b] = [s64(p), s64(q)];
    if (b === 0n) return M64 - 1n;
    if (a === -(2n ** 63n) && b === -1n) return p;
    return u64(a / b);
  },
  rem_u_64: (p, q) => (q === 0n ? p : p % q),
  rem_s_64: (p, q) => {
    const [a, b] = [s64(p), s64(q)];
    if (a === -(2n ** 63n) && b === -1n) return 0n;
    return u64(b === 0n ? a : a % b);
  },
  shlo_l_64: (p, q) => mod(p << mod(q, 64n), M64),
  shlo_r_64: (p, q) => p >> mod(q, 64n),
  shar_r_64: (p, q) => u64(s64(p) >> mod(q, 64n)),
  neg_add_64: (p, q) => mod(q - p, M64),
  rot_l_64: (p, q) => rotateRight(p, 64n - mod(q, 64n), 64n),
  rot_r_64: (p, q) => rotateRight(p, mod(q, 64n), 64n),
  mul_upper_s_s: (p, q) => u64((s64(p) * s64(q)) >> 64n),
  mul_upper_u_u: (p, q) => (p * q) >> 64n,
  mul_upper_s_u: (p, q) => u64((s64(p) * q) >> 64n),
  and: (p, q) => p & q,
  or: (p, q) => p | q,
  xor: (p, q) => p ^ q,
  and_inv: (p, q) => mod(p & ~q, M64),
  or_inv: (p, q) => mod(p | ~q, M64),
  xnor: (p, q) => mod(~(p ^ q), M64),
  set_lt_u: (p, q) => bool(p < q),
  set_lt_s: (p, q) => bool(s64(p) < s64(q)),
  set_gt_u: (p, q) => bool(p > q),
  set_gt_s: (p, q) => bool(s64(p) > s64(q)),
  cmov_iz: (p, q, old) => (q === 0n ? p : old),
  cmov_nz: (p, q, old) => (q !== 0n ? p : old),
  max: (p, q) => u64(s64(p) > s64(q) ? s64(p) : s64(q)),
  max_u: (p, q) => (p > q ? p : q),
  min: (p, q) => u64(s64(p) < s64(q) ? s64(p) : s64(q)),
  min_u: (p, q) => (p < q ? p : q),
};

/**
 * An instruction's operation and the order of its inputs. The immediate forms share the
 * three-register operation: add_imm_64 is add_64, shlo_l_imm_alt_32 is shlo_l_32 with its
 * inputs swapped. cmov…_imm reads that way round too: its immediate is the value moved.
 */
export function operationOf(name: string): { operation: string; swapped: boolean } {
  const operation = name.replace("_imm", "").replace("_alt", "");
  const swapped = name.includes("_alt") || (name.startsWith("cmov") && name.endsWith("_imm"));
  return { operation, swapped };
}
