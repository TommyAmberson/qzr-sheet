/** Elim lanes for the schedule editor's Format header.
 *
 *  This org names lanes by division suffix: every division has an implicit
 *  main lane (`Div 1`, `Div 2`, …); larger divisions can split out
 *  consolation lanes at stats break (`Div 2C`, `Div 3C`, `Div 3CC`).
 *  See `project_division_naming.md` for the convention.
 *
 *  Lane size (team count) is admin-specified. Quiz count is derived from
 *  size via the rule book's bracket templates (9-team A/B/C in
 *  `docs/rules.md`) for the standard case, with rough estimates for
 *  off-spec sizes that the admin will refine when picking a template. */

export type LaneId = 'main' | 'c' | 'cc'

/** Lanes the user can toggle on/off per division. `main` is implicit. */
export const TOGGLEABLE_LANES: readonly LaneId[] = ['c', 'cc']

export interface ExtraLane {
  id: LaneId
  teamCount: number
}

/** Suffix appended to the division name for display. */
export function laneSuffix(lane: LaneId): string {
  return lane === 'main' ? '' : lane.toUpperCase()
}

/** "Div 2C", "Div 3CC" — what meet directors actually call them. */
export function laneLabel(division: string, lane: LaneId): string {
  return `Div ${division}${laneSuffix(lane)}`
}

/** Quiz count for a lane of N teams. Rough estimate until the admin
 *  attaches a specific bracket template:
 *  - N ≤ 3:  N (single round-robin slot)
 *  - 4–8:    N (mixed-template heuristic)
 *  - 9:      9 (rule book Bracket A; see docs/rules.md §"Bracket A")
 *  - 10–12:  13 (Winkler-derived templates; see example-winkler-2026.md §6.1)
 *  - 13+:    teamCount (admin must pick custom template) */
export function estimateLaneQuizzes(teamCount: number): number {
  if (teamCount <= 0) return 0
  if (teamCount <= 8) return teamCount
  if (teamCount === 9) return 9
  if (teamCount <= 12) return 13
  return teamCount
}

/** Default size when the admin first toggles on a consolation lane.
 *  Half of what's left in main, capped sensibly. */
export function defaultExtraLaneSize(remainingInMain: number): number {
  return Math.max(0, Math.min(6, Math.floor(remainingInMain / 2)))
}
