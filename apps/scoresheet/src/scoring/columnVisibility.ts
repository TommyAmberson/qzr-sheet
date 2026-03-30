import { CellValue, QuestionType, buildKeyToIdx, type Column } from '../types/scoresheet'
import { ColStatus, colHasAnyContent } from './helpers'
import { computeGreyedOut } from './greyedOut'

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
  colStatuses: ColStatus[],
): boolean {
  if (colHasAnyContent(cellData, colIdx)) return true
  if (noJumps[colIdx]) return true

  const col = cols[colIdx]!
  if (col.type === QuestionType.A) {
    const baseIdx = keyToIdx.get(`${col.number}`)
    if (baseIdx === undefined) return false
    return colStatuses[baseIdx] === ColStatus.Errored && colStatuses[colIdx] !== ColStatus.Skipped
  }
  if (col.type === QuestionType.B) {
    const aIdx = keyToIdx.get(`${col.number}A`)
    if (aIdx === undefined) return false
    // B is needed when A errored (normal flow) or A was skipped/bypassed (but B was not)
    if (colStatuses[aIdx] === ColStatus.Errored) return true
    return colStatuses[aIdx] === ColStatus.Skipped && colStatuses[colIdx] !== ColStatus.Skipped
  }
  return false
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
  colStatuses?: ColStatus[],
): Set<number> {
  const statuses = colStatuses ?? computeGreyedOut(cellData, cols).colStatuses
  const maxOtQuestion = 20 + visibleOtRounds * 3
  const keyToIdx = buildKeyToIdx(cols)
  const orphaned = new Set<number>()

  for (let idx = 0; idx < cols.length; idx++) {
    const col = cols[idx]!

    if (col.type === QuestionType.A || col.type === QuestionType.B) {
      const hasContent = colHasAnyContent(cellData, idx) || noJumps[idx]
      if (!hasContent) continue

      let parentTriggered = false
      if (col.type === QuestionType.A) {
        const baseIdx = keyToIdx.get(`${col.number}`)
        parentTriggered =
          baseIdx !== undefined &&
          statuses[baseIdx] === ColStatus.Errored &&
          statuses[idx] !== ColStatus.Skipped
      } else {
        const aIdx = keyToIdx.get(`${col.number}A`)
        if (aIdx !== undefined) {
          parentTriggered =
            statuses[aIdx] === ColStatus.Errored ||
            (statuses[aIdx] === ColStatus.Skipped && statuses[idx] !== ColStatus.Skipped)
        }
      }

      const otOrphaned = col.isOvertime && col.number > maxOtQuestion
      if (!parentTriggered || otOrphaned) {
        orphaned.add(idx)
      }
    } else if (col.isOvertime && col.number > maxOtQuestion) {
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
  colStatuses?: ColStatus[],
): VisibleColumn[] {
  const statuses = colStatuses ?? computeGreyedOut(cellData, cols).colStatuses
  const maxOtQuestion = 20 + visibleOtRounds * 3
  const keyToIdx = buildKeyToIdx(cols)

  return cols
    .map((col, idx) => ({ col, idx }))
    .filter(({ col, idx }) => {
      // A/B columns: only show when needed
      if (col.type === QuestionType.A || col.type === QuestionType.B) {
        return abColumnNeededWith(cellData, cols, keyToIdx, noJumps, idx, statuses)
      }

      // OT normal columns beyond visible rounds: hide unless they have content/no-jump
      if (col.isOvertime && col.number > maxOtQuestion) {
        return colHasAnyContent(cellData, idx) || noJumps[idx]
      }

      return true
    })
}
