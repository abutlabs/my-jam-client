import { test } from "node:test";
import assert from "node:assert/strict";
import { opcodeInfo } from "../src/pvm/instructions.ts";
import { HALT_ADDRESS, newMachine, run, step } from "../src/pvm/machine.ts";
import type { Program } from "../src/pvm/program.ts";
import { assemble } from "../src/pvm/program.ts";
import type { Exit, Machine } from "../src/pvm/machine.ts";

const MAX = 2n ** 64n - 1n; // all 64 bits set: −1, read as signed

/** Runs one branch, with r0 = p and r1 = q: does it jump (to 5), or fall through? */
function jumps(branch: number[], p: bigint, q = 0n): boolean {
  const fallthroughs = Array.from({ length: 5 - branch.length }, () => [1]); // up to 5
  const machine = newMachine(assemble([branch, ...fallthroughs, [0]]), [p, q]);
  step(machine);
  return machine.pc === 5;
}

// A branch on two registers is [opcode, A + 16·B, offset]: here A = r0, B = r1, offset 5.
test("signed or unsigned: −1 is the biggest number there is, or less than 1", () => {
  const unsignedLess: boolean = jumps([172, 0x10, 5], MAX, 1n); // branch_lt_u: 2^64 − 1 < 1? no
  assert.equal(unsignedLess, false);
  const signedLess: boolean = jumps([173, 0x10, 5], MAX, 1n); // branch_lt_s: −1 < 1? yes
  assert.equal(signedLess, true);
});

// With an immediate it's [opcode, A + 16·l_X, X, offset]: here A = r0 and X is one byte.
test("an immediate branch compares with ν_X, sign-extended like every immediate", () => {
  const lessOrEqual: boolean = jumps([84, 0x10, 3, 5], 3n); // branch_le_u_imm: 3 ≤ 3
  assert.equal(lessOrEqual, true);
  const less: boolean = jumps([83, 0x10, 3, 5], 3n); // branch_lt_u_imm: 3 < 3? no
  assert.equal(less, false);
  const overMax: boolean = jumps([86, 0x10, 0xff, 5], 3n); // branch_gt_u_imm: 3 > 2^64 − 1? no
  assert.equal(overMax, false);
  const overMinusOne: boolean = jumps([90, 0x10, 0xff, 5], 3n); // branch_gt_s_imm: 3 > −1? yes
  assert.equal(overMinusOne, true);
});

/** A function that doubles r2, at 6, and a call to it at 0: `call` must leave 2 in r0. */
function withCall(call: number[]): Program {
  const program = assemble([
    call, //                    0: the call, 4 bytes
    [50, 0x01], //              4: jump_ind r1 + 0: halt; the function returns here
    [200, 0x22, 0x02], //       6: add_64 r2 = r2 + r2
    [50, 0x00], //              9: jump_ind r0 + 0: return
  ]);
  return { ...program, jumpTable: [4, 6] }; // address 2 leads to 4, address 4 to 6
}

test("a call: load_imm_jump leaves the way back in r0, and the function returns by it", () => {
  const machine: Machine = newMachine(withCall([80, 0x10, 2, 6]), [0n, HALT_ADDRESS, 21n]);
  const exit: Exit = run(machine);
  assert.equal(exit, "halt");
  const registers: bigint[] = machine.registers.slice(0, 3);
  assert.deepEqual(registers, [2n, HALT_ADDRESS, 42n]);
});

// load_imm_jump_ind is [opcode, A + 16·B, l_X, X, Y]: here A = r0, B = r3, X = 2, no Y.
test("a call through a register: load_imm_jump_ind jumps to φ_B + ν_Y", () => {
  const registers: bigint[] = [0n, HALT_ADDRESS, 21n, 4n]; // r3 = 4: the function's address
  const machine: Machine = newMachine(withCall([180, 0x30, 0x01, 2]), registers);
  const exit: Exit = run(machine);
  assert.equal(exit, "halt");
  assert.equal(machine.registers[2], 42n);
});

test("unlikely does nothing but move on", () => {
  const machine: Machine = newMachine(assemble([[2], [0]]));
  const exit: Exit = step(machine);
  assert.equal(exit, "continue");
  assert.equal(machine.pc, 1);
});

test("every branch in the GP's tables has a comparison: 16 of them", () => {
  let branches = 0;
  for (let opcode = 0; opcode < 256; opcode++) {
    if (!opcodeInfo(opcode)?.name.startsWith("branch_")) continue;
    assert.doesNotThrow(() => step(newMachine(assemble([[opcode], [0]]))));
    branches++;
  }
  assert.equal(branches, 16); // 10 against an immediate, 6 against a register
});
