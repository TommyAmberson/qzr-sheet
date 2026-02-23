import { CellValue, QuestionType, type Column } from '../types/scoresheet'
import { anyTeamHasAnswer, colHasAnyContent, anyTeamHasValue } from './helpers'

/**
 * Determine how many overtime questions (columns) should be visible.
 *
 * Returns 0, 3, or 6:
 * - 0: no overtime needed (not enabled, regulation incomplete, or no tie)
 * - 3: first OT round (questions 21–23)
 * - 6: second OT round (questions 24–26) — first round complete but still tied
 *
 * A/B sub-columns for each OT question follow the same show/hide logic as
 * regulation A/B columns (handled separately by abColumnNeeded).
 */
export function overtimeQuestionsNeeded(
  overtimeEnabled: boolean,
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
  teamScores: number[],
): number {
  if (!overtimeEnabled) return 0

  // If second OT round already has content, keep both rounds visible
  if (otRoundHasContent(cellData, cols, 24, 26)) return 6

  // If first OT round already has content, keep it visible
  if (otRoundHasContent(cellData, cols, 21, 23)) {
    // Check if first round is complete and still tied — show second round
    if (otRoundComplete(cellData, cols, noJumps, 21, 23) && hasRelevantTie(teamScores)) {
      return 6
    }
    return 3
  }

  // No OT content yet — only show first round if regulation complete and tied
  if (!regulationComplete(cellData, cols, noJumps)) return 0
  if (!hasRelevantTie(teamScores)) return 0

  return 3
}

/** Whether all regulation questions (1–20) are answered or no-jumped */
function regulationComplete(
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
): boolean {
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]!
    if (col.isOvertime) continue

    // Skip A/B columns that aren't needed
    if (col.type === QuestionType.A || col.type === QuestionType.B) {
      if (!abColumnNeeded(cellData, cols, ci)) continue
    }

    if (noJumps[ci]) continue
    if (!hasAnswer(cellData, ci)) return false
  }

  return true
}

/** Whether any column in an overtime round has content (answers or fouls) */
function otRoundHasContent(
  cellData: CellValue[][][],
  cols: Column[],
  fromQ: number,
  toQ: number,
): boolean {
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]!
    if (!col.isOvertime) continue
    if (col.number < fromQ || col.number > toQ) continue
    if (colHasAnyContent(cellData, ci)) return true
  }
  return false
}

/** Whether an overtime round (e.g. Q21–23 or Q24–26) is complete */
function otRoundComplete(
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
  fromQ: number,
  toQ: number,
): boolean {
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]!
    if (!col.isOvertime) continue
    if (col.number < fromQ || col.number > toQ) continue

    if (col.type === QuestionType.A || col.type === QuestionType.B) {
      if (!abColumnNeeded(cellData, cols, ci)) continue
    }

    if (noJumps[ci]) continue
    if (!hasAnswer(cellData, ci)) return false
  }

  return true
}

/** Whether an A/B column is needed (same logic as useScoresheet.abColumnNeeded) */
function abColumnNeeded(
  cellData: CellValue[][][],
  cols: Column[],
  colIdx: number,
): boolean {
  if (colHasAnyContent(cellData, colIdx)) return true
  const col = cols[colIdx]!
  if (col.type === QuestionType.A) {
    const baseIdx = cols.findIndex(
      (c) => c.number === col.number && c.type === QuestionType.Normal,
    )
    return baseIdx >= 0 && anyTeamHasValue(cellData, baseIdx, CellValue.Error)
  }
  if (col.type === QuestionType.B) {
    const aIdx = cols.findIndex(
      (c) => c.number === col.number && c.type === QuestionType.A,
    )
    return aIdx >= 0 && anyTeamHasValue(cellData, aIdx, CellValue.Error)
  }
  return false
}

/** Whether a column has any answer (C/E/B/MB — not empty, not foul-only) */
function hasAnswer(cellData: CellValue[][][], colIdx: number): boolean {
  return anyTeamHasAnswer(cellData, colIdx)
}

/** Whether at least two teams share the same score (relevant tie) */
function hasRelevantTie(scores: number[]): boolean {
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      if (scores[i] === scores[j]) return true
    }
  }
  return false
}
