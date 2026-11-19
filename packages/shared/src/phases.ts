/**
 * Meet-wide phase lifecycle. See `docs/scheduling.md` §2.
 *
 * Order is meaningful: the index in this array determines whether a transition
 * is forward (advance), backward (revert), or invalid (multi-step).
 */
export const MEET_PHASES = ['registration', 'build', 'live', 'review', 'done'] as const
export type MeetPhase = (typeof MEET_PHASES)[number]

/** Whether stored quizzes may change: by anyone allowed while live, only by an admin in review */
export function mayChangeQuizzes(phase: MeetPhase, admin: boolean): boolean {
  return phase === 'live' || (phase === 'review' && admin)
}

/**
 * Per-division state inside the `live` meet phase, which the admin can still correct in `review`.
 * Same single-step semantics.
 */
export const DIVISION_STATES = [
  'prelim_running',
  'stats_break',
  'elim_running',
  'finals',
  'division_done',
] as const
export type DivisionStateValue = (typeof DIVISION_STATES)[number]
