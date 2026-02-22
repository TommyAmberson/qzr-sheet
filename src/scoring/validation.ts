import { CellValue, QuestionType, type Column } from '../types/scoresheet'
import type { GreyedOutResult } from './greyedOut'

export enum ValidationCode {
  /** Two+ quizzers on the same team have answers (non-foul) on the same column */
  DuplicateAnswer = 'duplicate-answer',
  /** Quizzer's team is tossed-up on this column — they can't jump */
  TossedUp = 'tossed-up',
  /** Two+ teams have answers (non-foul) on the same column */
  MultipleTeams = 'multiple-teams',
  /** Wrong cell type for the column (e.g. C/E on a B column, or B/MB without bonus situation) */
  WrongCellType = 'wrong-cell-type',
  /** Answer on a column that's already resolved by a parent (e.g. 17A when 17 was correct) */
  QuestionResolved = 'question-resolved',
  /** Answer on a column marked as no-jump */
  NoJump = 'no-jump',
}

function isAnswer(v: CellValue): boolean {
  return v !== CellValue.Empty && v !== CellValue.Foul
}

/**
 * Validate all cells and return a map of "ti:qi:ci" → ValidationCode[].
 * Only cells with problems appear in the map.
 */
export function validateCells(
  cellData: CellValue[][][],
  cols: Column[],
  greyResult: GreyedOutResult,
  noJumps?: boolean[],
): Map<string, ValidationCode[]> {
  const errors = new Map<string, ValidationCode[]>()
  const teamCount = cellData.length

  function addError(ti: number, qi: number, ci: number, code: ValidationCode) {
    const key = `${ti}:${qi}:${ci}`
    const existing = errors.get(key)
    if (existing) {
      existing.push(code)
    } else {
      errors.set(key, [code])
    }
  }

  // Build lookup for resolved columns (A/B cascade from greyedOut)
  const keyToIdx = new Map<string, number>()
  cols.forEach((col, i) => keyToIdx.set(col.key, i))

  function anyTeamHasValue(colIdx: number, value: CellValue): boolean {
    for (let ti = 0; ti < teamCount; ti++) {
      for (const row of cellData[ti]!) {
        if (row[colIdx] === value) return true
      }
    }
    return false
  }

  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]!

    // Collect which teams have answers (non-foul) on this column
    const teamsWithAnswers: { ti: number; qi: number }[] = []

    for (let ti = 0; ti < teamCount; ti++) {
      const quizzerCount = cellData[ti]!.length
      const teamAnswers: { ti: number; qi: number }[] = []

      for (let qi = 0; qi < quizzerCount; qi++) {
        const v = cellData[ti]![qi]![ci]!
        if (v === CellValue.Empty) continue

        // --- No-jump ---
        if (noJumps?.[ci]) {
          addError(ti, qi, ci, ValidationCode.NoJump)
        }

        // --- Wrong cell type ---
        if (col.type === QuestionType.B) {
          // B columns: only B/MB/F allowed
          if (v === CellValue.Correct || v === CellValue.Error) {
            addError(ti, qi, ci, ValidationCode.WrongCellType)
          }
        } else {
          // Non-B columns: check bonus situation for this team
          const isBonusSituation = (() => {
            let tossedTeams = 0
            for (let t = 0; t < teamCount; t++) {
              if (t !== ti && greyResult.tossedUp.has(`${t}:${ci}`)) tossedTeams++
            }
            return tossedTeams === teamCount - 1
          })()

          // B/MB only valid if it's a bonus situation
          if ((v === CellValue.Bonus || v === CellValue.MissedBonus) && !isBonusSituation) {
            addError(ti, qi, ci, ValidationCode.WrongCellType)
          }
          // C/E invalid if it IS a bonus situation (should be B/MB)
          if ((v === CellValue.Correct || v === CellValue.Error) && isBonusSituation) {
            addError(ti, qi, ci, ValidationCode.WrongCellType)
          }
        }

        // --- Tossed up ---
        if (isAnswer(v) && greyResult.tossedUp.has(`${ti}:${ci}`)) {
          addError(ti, qi, ci, ValidationCode.TossedUp)
        }

        // --- Question resolved (A/B cascade) ---
        if (isAnswer(v)) {
          let resolved = false
          if (col.type === QuestionType.A) {
            // Check if base normal question was resolved (C/B/MB)
            const baseIdx = keyToIdx.get(`${col.number}`)
            if (baseIdx !== undefined) {
              resolved =
                anyTeamHasValue(baseIdx, CellValue.Correct) ||
                anyTeamHasValue(baseIdx, CellValue.Bonus) ||
                anyTeamHasValue(baseIdx, CellValue.MissedBonus)
            }
          } else if (col.type === QuestionType.B) {
            // Check if A question was resolved
            const aIdx = keyToIdx.get(`${col.number}A`)
            if (aIdx !== undefined) {
              const aResolved =
                anyTeamHasValue(aIdx, CellValue.Correct) ||
                anyTeamHasValue(aIdx, CellValue.Bonus) ||
                anyTeamHasValue(aIdx, CellValue.MissedBonus)
              if (aResolved) resolved = true
            }
            // Also check if base was resolved (C/B/MB, not E)
            const baseIdx = keyToIdx.get(`${col.number}`)
            if (baseIdx !== undefined) {
              const baseResolved =
                anyTeamHasValue(baseIdx, CellValue.Correct) ||
                anyTeamHasValue(baseIdx, CellValue.Bonus) ||
                anyTeamHasValue(baseIdx, CellValue.MissedBonus)
              if (baseResolved) resolved = true
            }
          }
          if (resolved) {
            addError(ti, qi, ci, ValidationCode.QuestionResolved)
          }

          teamAnswers.push({ ti, qi })
        }
      }

      // --- Duplicate answers (same team, same column) ---
      if (teamAnswers.length > 1) {
        for (const { ti: t, qi: q } of teamAnswers) {
          addError(t, q, ci, ValidationCode.DuplicateAnswer)
        }
      }

      teamsWithAnswers.push(...teamAnswers)
    }

    // --- Multiple teams with answers on same column ---
    const uniqueTeams = new Set(teamsWithAnswers.map(({ ti }) => ti))
    if (uniqueTeams.size > 1) {
      for (const { ti, qi } of teamsWithAnswers) {
        addError(ti, qi, ci, ValidationCode.MultipleTeams)
      }
    }
  }

  return errors
}
