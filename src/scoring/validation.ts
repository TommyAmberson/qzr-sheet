import { CellValue, QuestionType, KEY_TO_IDX, type Column } from '../types/scoresheet'
import type { GreyedOutResult } from './greyedOut'
import {
  isAnswer,
  anyTeamHasValue as _anyTeamHasValue,
  isResolved as _isResolved,
  isBonusSituation,
} from './helpers'

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
  /** Non-foul answer by a quizzer who has already quizzed out or errored/fouled out */
  QuizzerOut = 'quizzer-out',
  /** Quizzer fouled on this question and can't answer sub-parts */
  FouledOnQuestion = 'fouled-on-question',
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

  // Bind helpers to this cellData
  const anyTeamHasValue = (ci: number, v: CellValue) => _anyTeamHasValue(cellData, ci, v)
  const isResolved = (ci: number) => _isResolved(cellData, ci)

  function addError(ti: number, qi: number, ci: number, code: ValidationCode) {
    const key = `${ti}:${qi}:${ci}`
    const existing = errors.get(key)
    if (existing) {
      existing.push(code)
    } else {
      errors.set(key, [code])
    }
  }

  // Track per-quizzer running counts for out detection (left-to-right)
  // qCorrects[ti][qi], qErrorsFouls[ti][qi]
  const qCorrects: number[][] = cellData.map(team => new Array(team.length).fill(0))
  const qErrorsFouls: number[][] = cellData.map(team => new Array(team.length).fill(0))

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

        // --- No-jump (fouls are still valid on no-jump columns) ---
        if (noJumps?.[ci] && v !== CellValue.Foul) {
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
          const isBonus = isBonusSituation(greyResult.tossedUp, ti, ci, teamCount)

          // B/MB only valid if it's a bonus situation
          if ((v === CellValue.Bonus || v === CellValue.MissedBonus) && !isBonus) {
            addError(ti, qi, ci, ValidationCode.WrongCellType)
          }
          // C/E invalid if it IS a bonus situation (should be B/MB)
          if ((v === CellValue.Correct || v === CellValue.Error) && isBonus) {
            addError(ti, qi, ci, ValidationCode.WrongCellType)
          }
        }

        // --- Quizzer out ---
        // Check BEFORE updating counts: if already out, flag appropriately
        const isQuizzedOut = qCorrects[ti]![qi]! >= 4
        const isErrorFoulOut = qErrorsFouls[ti]![qi]! >= 3
        if (isErrorFoulOut && v !== CellValue.Foul) {
          // Error/foul out: must leave, can't answer anything (except fouls)
          addError(ti, qi, ci, ValidationCode.QuizzerOut)
        } else if (isQuizzedOut && v !== CellValue.Foul && v !== CellValue.Bonus && v !== CellValue.MissedBonus) {
          // Quiz out: stays on bench, can still answer bonus (B/MB) but not C/E
          addError(ti, qi, ci, ValidationCode.QuizzerOut)
        }

        // Update running counts for this quizzer
        if (v === CellValue.Correct && !col.isOvertime) {
          qCorrects[ti]![qi]!++
        } else if (v === CellValue.Error && !col.isOvertime) {
          qErrorsFouls[ti]![qi]!++
        } else if (v === CellValue.Foul && !col.isOvertime) {
          qErrorsFouls[ti]![qi]!++
        }

        // --- Fouled on question (can't answer sub-parts) ---
        if (greyResult.fouledQuizzers.has(`${ti}:${qi}:${ci}`)) {
          addError(ti, qi, ci, ValidationCode.FouledOnQuestion)
        }

        // --- Tossed up ---
        if (isAnswer(v) && greyResult.tossedUp.has(`${ti}:${ci}`)) {
          addError(ti, qi, ci, ValidationCode.TossedUp)
        }

        // --- Question resolved (A/B cascade) ---
        if (isAnswer(v)) {
          let resolved = false
          if (col.type === QuestionType.A) {
            const baseIdx = KEY_TO_IDX.get(`${col.number}`)
            if (baseIdx !== undefined) resolved = isResolved(baseIdx)
          } else if (col.type === QuestionType.B) {
            const aIdx = KEY_TO_IDX.get(`${col.number}A`)
            if (aIdx !== undefined && isResolved(aIdx)) resolved = true
            const baseIdx = KEY_TO_IDX.get(`${col.number}`)
            if (baseIdx !== undefined && isResolved(baseIdx)) resolved = true
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
