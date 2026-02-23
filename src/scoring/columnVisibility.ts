import { CellValue, QuestionType, buildKeyToIdx, type Column } from '../types/scoresheet'
import { anyTeamHasValue, colHasAnyContent } from './helpers'

export interface VisibleColumn {
  col: Column
  idx: number
}

/** Internal helper that accepts a pre-built keyToIdx map */
function abColumnNeededWith(
  cellData: CellValue[][][],
  cols: Column[],
  keyToIdx: Map<string, number>,
  noJumps: boolean[],
  colIdx: number,
): boolean {
  if (colHasAnyContent(cellData, colIdx)) return true
  if (noJumps[colIdx]) return true

  const col = cols[colIdx]!
  if (col.type === QuestionType.A) {
    const baseIdx = keyToIdx.get(`${col.number}`)
    return baseIdx !== undefined && anyTeamHasValue(cellData, baseIdx, CellValue.Error)
  }
  if (col.type === QuestionType.B) {
    const aIdx = keyToIdx.get(`${col.number}A`)
    return aIdx !== undefined && anyTeamHasValue(cellData, aIdx, CellValue.Error)
  }
  return false
}

/**
 * Whether an A/B column should be shown.
 *
 * An A/B column is visible if:
 * - It has any cell content (answers/fouls), OR
 * - It has a no-jump marker, OR
 * - Its parent column had an error (triggering the A/B flow)
 */
export function abColumnNeeded(
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
  colIdx: number,
): boolean {
  return abColumnNeededWith(cellData, cols, buildKeyToIdx(cols), noJumps, colIdx)
}

/**
 * Compute which columns should be visible in the scoresheet.
 *
 * General rule: if a column has content or a no-jump marker, always show it
 * (validation will flag it as invalid if appropriate).
 *
 * @param cellData - 3D cell grid [team][quizzer][col]
 * @param cols - all column definitions (including OT)
 * @param noJumps - per-column no-jump flags
 * @param visibleOtRounds - how many OT rounds should be shown based on game state
 */
export function computeVisibleColumns(
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
  visibleOtRounds: number,
): VisibleColumn[] {
  const maxOtQuestion = 20 + visibleOtRounds * 3
  const keyToIdx = buildKeyToIdx(cols)

  return cols
    .map((col, idx) => ({ col, idx }))
    .filter(({ col, idx }) => {
      // A/B columns: only show when needed
      if (col.type === QuestionType.A || col.type === QuestionType.B) {
        return abColumnNeededWith(cellData, cols, keyToIdx, noJumps, idx)
      }

      // OT normal columns beyond visible rounds: hide unless they have content/no-jump
      if (col.isOvertime && col.number > maxOtQuestion) {
        return colHasAnyContent(cellData, idx) || noJumps[idx]
      }

      return true
    })
}
