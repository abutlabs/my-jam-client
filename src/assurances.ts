// Assurances (GP §11): validators say which cores' data they hold, and a report whose data
// enough of them hold becomes available.

import type { Assurance } from "./block.ts";
import type { Bytes } from "./bytes.ts";
import type { PendingReport } from "./cores.ts";
import type { WorkReport } from "./work.ts";
import { assuranceSigned } from "./block.ts";
import { toHex } from "./bytes.ts";

/** Bit c of a bitfield. Bits are packed least significant first (GP App. C). */
export function bitAt(bitfield: Bytes, c: number): boolean {
  return ((bitfield[Math.floor(c / 8)] >> (c % 8)) & 1) === 1;
}

/** How many assurances say "I hold this core's data". */
export function assuredCount(assurances: Assurance[], core: number): number {
  return assurances.filter((assurance) => bitAt(assurance.bitfield, core)).length;
}

/** 𝐑: the reports that become available, core by core. */
export function nowAvailable(
  cores: (PendingReport | null)[],
  assurances: Assurance[],
  validators: number,
): WorkReport[] {
  const available = availableCores(cores, assurances, validators);
  return available.map((core) => (cores[core] as PendingReport).guarantee.report);
}

/** The cores whose pending report becomes available: more than 2/3 of κ hold its data. */
export function availableCores(
  cores: (PendingReport | null)[],
  assurances: Assurance[],
  validators: number, // |κ|
): number[] {
  const available: number[] = [];
  cores.forEach((pending, core) => {
    const assured = assuredCount(assurances, core);
    if (pending !== null && 3 * assured > 2 * validators) available.push(core);
  });
  return available;
}

/** U: the slots a report may wait on its core for its data to become available. */
export const AVAILABILITY_TIMEOUT = 5;

/**
 * ρ‡ (GP §11): a core lets go of its report when the report became available, when it
 * has waited U slots, or when the number of validators changed.
 */
export function clearCores(
  cores: (PendingReport | null)[],
  available: number[], // the cores whose report became available
  slot: number, // this block's slot
  resized: boolean, // |κ| ≠ |κ′|
): (PendingReport | null)[] {
  return cores.map((pending, core) => {
    if (pending === null) return null;
    const timedOut = slot >= pending.registered_slot + AVAILABILITY_TIMEOUT;
    return available.includes(core) || timedOut || resized ? null : pending;
  });
}

/**
 * Are a block's assurances valid (GP §11.2)? The first rule they break, under the test
 * vectors' name for it, or null if they keep every rule. `keys` is κ's Ed25519 keys and
 * `cores` is ρ†, the cores after the judgments. The signatures go last: they're the slow
 * check.
 */
export function assuranceError(
  assurances: Assurance[],
  parent: Bytes, // H_P: the parent block's hash
  keys: Bytes[],
  cores: (PendingReport | null)[],
): string | null {
  const ordered = (a: Assurance, i: number) =>
    i === 0 || assurances[i - 1].validator_index < a.validator_index;
  const engaged = (a: Assurance) =>
    cores.every((pending, c) => pending !== null || !bitAt(a.bitfield, c));
  if (!assurances.every((a) => toHex(a.anchor) === toHex(parent))) return "bad_attestation_parent";
  if (!assurances.every((a) => a.validator_index < keys.length)) return "bad_validator_index";
  if (!assurances.every(ordered)) return "not_sorted_or_unique_assurers";
  if (!assurances.every(engaged)) return "core_not_engaged";
  if (!assurances.every((a) => assuranceSigned(keys, a))) return "bad_signature";
  return null;
}
