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
  cascadeDisabled: Set<number>,
): boolean {
  if (colHasAnyContent(cellData, colIdx)) return true
  if (noJumps[colIdx]) return true

  const col = cols[colIdx]!
  if (col.type === QuestionType.A) {
    const baseIdx = keyToIdx.get(`${col.number}`)
    if (baseIdx === undefined) return false
    // Don't show A if it was bypassed (parent error routed to B instead)
    if (cascadeDisabled.has(colIdx)) return false
    return anyTeamHasValue(cellData, baseIdx, CellValue.Error)
  }
  if (col.type === QuestionType.B) {
    const aIdx = keyToIdx.get(`${col.number}A`)
    if (aIdx === undefined) return false
    // Show B when A had an error (normal toss-up flow), or when A was bypassed (bonus routing)
    const aWasBypassed = cascadeDisabled.has(aIdx) && !cascadeDisabled.has(colIdx)
    return anyTeamHasValue(cellData, aIdx, CellValue.Error) || aWasBypassed
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
 *
 * A columns are suppressed when the parent error bypassed them in favour of B
 * (bonus-routing: only one team was eligible, so A toss-up is skipped).
 */
export function abColumnNeeded(
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
  colIdx: number,
  cascadeDisabled: Set<number> = new Set(),
): boolean {
  return abColumnNeededWith(cellData, cols, buildKeyToIdx(cols), noJumps, colIdx, cascadeDisabled)
}

/**
 * Compute which columns are "orphaned" — visible only because they have
 * content or a no-jump marker, not because game logic requires them.
 *
 * These columns should be shown so users can clear the data, but all
 * content on them should be flagged as invalid by validation.
 */
export function computeOrphanedColumns(
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
  visibleOtRounds: number,
  cascadeDisabled: Set<number> = new Set(),
): Set<number> {
  const maxOtQuestion = 20 + visibleOtRounds * 3
  const keyToIdx = buildKeyToIdx(cols)
  const orphaned = new Set<number>()

  for (let idx = 0; idx < cols.length; idx++) {
    const col = cols[idx]!

    if (col.type === QuestionType.A || col.type === QuestionType.B) {
      // A/B column: orphaned if visible only due to content/no-jump
      // (i.e., parent didn't have an error to trigger it)
      const hasContent = colHasAnyContent(cellData, idx) || noJumps[idx]
      if (!hasContent) continue // not visible at all — not orphaned

      // Check if the parent error legitimately triggers this column
      let parentTriggered = false
      if (col.type === QuestionType.A) {
        const baseIdx = keyToIdx.get(`${col.number}`)
        parentTriggered =
          baseIdx !== undefined &&
          anyTeamHasValue(cellData, baseIdx, CellValue.Error) &&
          !cascadeDisabled.has(idx)
      } else {
        const aIdx = keyToIdx.get(`${col.number}A`)
        if (aIdx !== undefined) {
          const aWasBypassed = cascadeDisabled.has(aIdx) && !cascadeDisabled.has(idx)
          parentTriggered = anyTeamHasValue(cellData, aIdx, CellValue.Error) || aWasBypassed
        }
      }

      // Also orphaned if the OT column itself is beyond visible rounds
      const otOrphaned = col.isOvertime && col.number > maxOtQuestion

      if (!parentTriggered || otOrphaned) {
        orphaned.add(idx)
      }
    } else if (col.isOvertime && col.number > maxOtQuestion) {
      // OT normal column beyond visible rounds: orphaned if has content/no-jump
      if (colHasAnyContent(cellData, idx) || noJumps[idx]) {
        orphaned.add(idx)
      }
    }
  }

  return orphaned
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
  cascadeDisabled: Set<number> = new Set(),
): VisibleColumn[] {
  const maxOtQuestion = 20 + visibleOtRounds * 3
  const keyToIdx = buildKeyToIdx(cols)

  return cols
    .map((col, idx) => ({ col, idx }))
    .filter(({ col, idx }) => {
      // A/B columns: only show when needed
      if (col.type === QuestionType.A || col.type === QuestionType.B) {
        return abColumnNeededWith(cellData, cols, keyToIdx, noJumps, idx, cascadeDisabled)
      }

      // OT normal columns beyond visible rounds: hide unless they have content/no-jump
      if (col.isOvertime && col.number > maxOtQuestion) {
        return colHasAnyContent(cellData, idx) || noJumps[idx]
      }

      return true
    })
}
