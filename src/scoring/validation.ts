import { CellValue, QuestionType, type Column } from '../types/scoresheet'
import type { GreyedOutResult } from './greyedOut'
import { isAnswer, isBonusSituation } from './helpers'

export enum ValidationCode {
  /** Answer by a quizzer with no name (empty seat) */
  EmptySeat = 'empty-seat',
  /** Two+ quizzers answered the same question (same team or different teams) */
  DuplicateAnswer = 'duplicate-answer',
  /** Team answered a toss-up question they can't jump on */
  WrongTeamTossUp = 'wrong-team-toss-up',
  /** Team answered a bonus question that belongs to another team */
  WrongTeamBonus = 'wrong-team-bonus',
  /** C/E on a bonus question — should use B/MB */
  IsBonus = 'is-bonus',
  /** B/MB on a non-bonus column — this is not a bonus question */
  NotBonus = 'not-bonus',
  /** Answer on a question that shouldn't be asked (resolved A/B, orphaned column, etc.) */
  QuestionNotNeeded = 'question-not-needed',
  /** Answer on a column marked as no-jump */
  NoJump = 'no-jump',
  /** Non-foul answer by a quizzer who has already quizzed out or errored/fouled out */
  QuizzerOut = 'quizzer-out',
  /** Quizzer fouled on this question and can't answer sub-parts */
  FouledOnQuestion = 'fouled-on-question',
  /** Non-foul answer on an overtime column by a team not eligible for overtime */
  NotInOvertime = 'not-in-overtime',
}

/** Human-readable message for each validation code */
const validationMessages: Record<ValidationCode, string> = {
  [ValidationCode.EmptySeat]: 'This seat is empty — add a quizzer name first',
  [ValidationCode.DuplicateAnswer]: 'Only one quizzer can answer per question — multiple answered',
  [ValidationCode.WrongTeamTossUp]: "Team can't answer this question — it's a toss-up",
  [ValidationCode.WrongTeamBonus]: "Team can't answer this question — it's another team's bonus",
  [ValidationCode.IsBonus]: 'This is a bonus question — answer must be a bonus',
  [ValidationCode.NotBonus]: 'This is not a bonus question — bonus answers are not allowed',
  [ValidationCode.QuestionNotNeeded]: "This question shouldn't be asked",
  [ValidationCode.NoJump]: 'No-jump means no one answered — but an answer is recorded here',
  [ValidationCode.QuizzerOut]: 'Quizzer has quizzed/errored/fouled out — they cannot answer',
  [ValidationCode.FouledOnQuestion]:
    'A foul on this numbered question makes the quizzer ineligible',
  [ValidationCode.NotInOvertime]: 'Only tied teams can answer in overtime — this team is not tied',
}

/** Get the human-readable message for a validation code */
export function validationMessage(code: ValidationCode): string {
  return validationMessages[code]
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
  orphanedColumns?: Set<number>,
  emptySeats?: Set<string>,
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
  const qCorrects: number[][] = cellData.map((team) => new Array(team.length).fill(0))
  const qErrors: number[][] = cellData.map((team) => new Array(team.length).fill(0))
  const qFouls: number[][] = cellData.map((team) => new Array(team.length).fill(0))

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

        // --- Empty seat ---
        if (emptySeats?.has(`${ti}:${qi}`)) {
          addError(ti, qi, ci, ValidationCode.EmptySeat)
        }

        // --- Column not active (orphaned) ---
        if (orphanedColumns?.has(ci)) {
          addError(ti, qi, ci, ValidationCode.QuestionNotNeeded)
        }

        // --- Not in overtime ---
        if (col.isOvertime && otEligibleTeams && !otEligibleTeams.has(ti) && v !== CellValue.Foul) {
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
            addError(ti, qi, ci, ValidationCode.IsBonus)
          }
        } else {
          // Non-B columns: check bonus situation for this team
          const isBonus = isBonusSituation(greyResult.tossedUp, ti, ci, teamCount)

          // B/MB only valid if it's a bonus situation
          if ((v === CellValue.Bonus || v === CellValue.MissedBonus) && !isBonus) {
            addError(ti, qi, ci, ValidationCode.NotBonus)
          }
          // C/E invalid if it IS a bonus situation (should be B/MB)
          if ((v === CellValue.Correct || v === CellValue.Error) && isBonus) {
            addError(ti, qi, ci, ValidationCode.IsBonus)
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
        } else if (
          isQuizzedOut &&
          v !== CellValue.Foul &&
          v !== CellValue.Bonus &&
          v !== CellValue.MissedBonus
        ) {
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

        // --- Tossed up / wrong team bonus ---
        if (isAnswer(v) && greyResult.tossedUp.has(`${ti}:${ci}`)) {
          // Check if some other team has a bonus situation on this column
          let isBonusForOther = false
          for (let oti = 0; oti < teamCount; oti++) {
            if (oti !== ti && isBonusSituation(greyResult.tossedUp, oti, ci, teamCount)) {
              isBonusForOther = true
              break
            }
          }
          addError(
            ti,
            qi,
            ci,
            isBonusForOther ? ValidationCode.WrongTeamBonus : ValidationCode.WrongTeamTossUp,
          )
        }

        // --- Question resolved (A/B cascade) ---
        if (isAnswer(v)) {
          if (greyResult.cascadeDisabled.has(ci)) {
            addError(ti, qi, ci, ValidationCode.QuestionNotNeeded)
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
        addError(ti, qi, ci, ValidationCode.DuplicateAnswer)
      }
    }
  }

  return errors
}
