/**
 * Meet-wide phase lifecycle. See `docs/scheduling.md` §2.
 *
 * Order is meaningful: the index in this array determines whether a transition
 * is forward (advance), backward (revert), or invalid (multi-step).
 */
export const MEET_PHASES = ['registration', 'build', 'live', 'done'] as const
export type MeetPhase = (typeof MEET_PHASES)[number]

/**
 * Per-division state inside the `live` meet phase. Same single-step semantics.
 */
export const DIVISION_STATES = [
  'prelim_running',
  'stats_break',
  'elim_running',
  'division_done',
] as const
export type DivisionStateValue = (typeof DIVISION_STATES)[number]
