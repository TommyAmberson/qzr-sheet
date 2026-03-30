import { CellValue } from '../types/scoresheet'

/**
 * Shared helper functions for querying the positional cell grid.
 *
 * All functions take `cellData: CellValue[][][]` (the 3D grid indexed by
 * [teamIdx][quizzerIdx][colIdx]) so they work as pure functions without
 * any Vue reactivity dependency.
 */

/**
 * Game-logic state of a single column, computed once per grid and consumed
 * by visibility, validation, and completeness checks.
 *
 * - `Pending`  — no non-foul answer yet; the column is waiting to be acted on.
 * - `Errored`  — someone answered incorrectly (E); the chain continues to the
 *                next sub-column (A or B) or the next numbered question.
 * - `Resolved` — the question was settled (C/B/MB); any sub-columns are skipped.
 * - `Skipped`  — this sub-column won't be asked because a parent resolved it,
 *                or because A was bypassed via bonus-routing.
 */
export enum ColStatus {
  Pending = 'pending',
  Errored = 'errored',
  Resolved = 'resolved',
  Skipped = 'skipped',
}

/** Whether a value counts as an "answer" (non-empty, non-foul) */
export function isAnswer(v: CellValue): boolean {
  return v !== CellValue.Empty && v !== CellValue.Foul
}

/** Whether a column has been resolved (C/B/MB — not E, not F) */
export function isResolved(cellData: CellValue[][][], colIdx: number): boolean {
  return (
    anyTeamHasValue(cellData, colIdx, CellValue.Correct) ||
    anyTeamHasValue(cellData, colIdx, CellValue.Bonus) ||
    anyTeamHasValue(cellData, colIdx, CellValue.MissedBonus)
  )
}

/** Whether a specific team has a specific value on a column */
export function teamHasValue(
  cellData: CellValue[][][],
  teamIdx: number,
  colIdx: number,
  value: CellValue,
): boolean {
  for (const row of cellData[teamIdx]!) {
    if (row[colIdx] === value) return true
  }
  return false
}

/** Whether a specific team has any answer (non-empty, non-foul) on a column */
export function teamHasAnswer(cellData: CellValue[][][], teamIdx: number, colIdx: number): boolean {
  for (const row of cellData[teamIdx]!) {
    if (isAnswer(row[colIdx]!)) return true
  }
  return false
}

/** Whether any team has an answer (non-empty, non-foul) on a column */
export function anyTeamHasAnswer(cellData: CellValue[][][], colIdx: number): boolean {
  for (let ti = 0; ti < cellData.length; ti++) {
    if (teamHasAnswer(cellData, ti, colIdx)) return true
  }
  return false
}

/** Whether any team has a specific value on a column */
export function anyTeamHasValue(
  cellData: CellValue[][][],
  colIdx: number,
  value: CellValue,
): boolean {
  for (let ti = 0; ti < cellData.length; ti++) {
    if (teamHasValue(cellData, ti, colIdx, value)) return true
  }
  return false
}

/** Whether any cell on a column is non-empty (including fouls) */
export function colHasAnyContent(cellData: CellValue[][][], colIdx: number): boolean {
  for (const team of cellData) {
    for (const row of team) {
      if (row[colIdx] !== CellValue.Empty) return true
    }
  }
  return false
}

/**
 * Whether a column is a bonus situation for a given team.
 * A bonus situation means every *other* team is tossed up on that column.
 */
export function isBonusSituation(
  tossedUp: Set<string>,
  teamIdx: number,
  colIdx: number,
  teamCount: number,
): boolean {
  let tossedTeams = 0
  for (let ti = 0; ti < teamCount; ti++) {
    if (ti !== teamIdx && tossedUp.has(`${ti}:${colIdx}`)) tossedTeams++
  }
  return tossedTeams === teamCount - 1
}
