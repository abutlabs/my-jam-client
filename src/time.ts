// Time: JAM counts six-second timeslots from the JAM Common Era (GP §4).

/** The JAM Common Era began at 12:00 UTC on 1 January 2025: seconds after the Unix epoch. */
export const JAM_COMMON_ERA = 1_735_732_800;

/** P: a timeslot lasts six seconds. */
export const SLOT_SECONDS = 6;

/** The timeslot a moment falls in: whole slots since the JAM Common Era. */
export function slotAt(date: Date): number {
  const ms = date.getTime() - JAM_COMMON_ERA * 1000;
  return Math.floor(ms / (SLOT_SECONDS * 1000));
}
