// Bits and bytes (GP App. A.5, two registers): instructions that count a register's bits,
// widen its lowest bytes, or turn it back to front. Each makes φ′_D from φ_A alone.

import { decodeFixed, encodeFixed } from "../codec/numbers.ts";
import { signExtend } from "./instructions.ts";

/** x's lowest n bits as a string of 0s and 1s, the highest first (the GP's B, reversed). */
const bits = (x: bigint, n: number) => BigInt.asUintN(n, x).toString(2).padStart(n, "0");
/** How many 1s there are, how many 0s come before the first 1, and how many after the last. */
const ones = (s: string) => BigInt(s.replaceAll("0", "").length);
const leadingZeros = (s: string) => BigInt(/^0*/.exec(s)![0].length);
const trailingZeros = (s: string) => BigInt(/0*$/.exec(s)![0].length);

/** Each instruction's operation, by name: x is φ_A, and the answer goes to φ′_D. */
export const BIT_OPERATIONS: Record<string, (x: bigint) => bigint> = {
  count_set_bits_64: (x) => ones(bits(x, 64)),
  count_set_bits_32: (x) => ones(bits(x, 32)),
  leading_zero_bits_64: (x) => leadingZeros(bits(x, 64)),
  leading_zero_bits_32: (x) => leadingZeros(bits(x, 32)),
  trailing_zero_bits_64: (x) => trailingZeros(bits(x, 64)),
  trailing_zero_bits_32: (x) => trailingZeros(bits(x, 32)),
  sign_extend_8: (x) => signExtend(1, BigInt.asUintN(8, x)),
  sign_extend_16: (x) => signExtend(2, BigInt.asUintN(16, x)),
  zero_extend_16: (x) => BigInt.asUintN(16, x),
  reverse_bytes: (x) => decodeFixed(encodeFixed(x, 8).reverse()), // ℰ₈, back to front
};
