import { CellValue, QuestionType, type Column } from '../types/scoresheet'
import type { GreyedOutResult } from './greyedOut'
import {
  isAnswer,
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
  /** Non-foul answer on an overtime column by a team not eligible for overtime */
  NotInOvertime = 'not-in-overtime',
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
  otEligibleTeams?: Set<number>,
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

  // Track per-quizzer running counts for out detection (left-to-right)
  // qCorrects[ti][qi], qErrors[ti][qi], qFouls[ti][qi]
  const qCorrects: number[][] = cellData.map(team => new Array(team.length).fill(0))
  const qErrors: number[][] = cellData.map(team => new Array(team.length).fill(0))
  const qFouls: number[][] = cellData.map(team => new Array(team.length).fill(0))

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

        // --- Not in overtime ---
        if (
          col.isOvertime &&
          otEligibleTeams &&
          !otEligibleTeams.has(ti) &&
          v !== CellValue.Foul
        ) {
          addError(ti, qi, ci, ValidationCode.NotInOvertime)
        }

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
        const isErrorOut = qErrors[ti]![qi]! >= 3
        const isFoulOut = qFouls[ti]![qi]! >= 3
        if ((isErrorOut || isFoulOut) && v !== CellValue.Foul) {
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
          qErrors[ti]![qi]!++
        } else if (v === CellValue.Foul && !col.isOvertime) {
          qFouls[ti]![qi]!++
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
          if (greyResult.cascadeDisabled.has(ci)) {
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
