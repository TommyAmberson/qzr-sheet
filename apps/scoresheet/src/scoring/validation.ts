import { CellValue, QuestionType, type Column } from '../types/scoresheet'
import type { GreyedOutResult } from './greyedOut'
import { ColStatus, isAnswer, isBonusSituation } from './helpers'
import { toSeatIdx, toTeamIdx, teamSeatKey, type TeamSeat } from '../types/indices'

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
  /** Timeout called after Q17+ where error points apply (not allowed per rules §8.a) */
  TimeoutAfterQ16 = 'timeout-after-q16',
  /** Team has used more than the allowed 2 timeouts */
  TooManyTimeouts = 'too-many-timeouts',
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
  [ValidationCode.TimeoutAfterQ16]:
    "Timeouts can't be called after error points (after question 17)",
  [ValidationCode.TooManyTimeouts]: 'Each team is allowed only 2 timeouts per quiz',
}

/** Get the human-readable message for a validation code */
export function validationMessage(code: ValidationCode): string {
  return validationMessages[code]
}

/**
 * Per-column nested map of validation errors. Outer key is `colIdx`, inner is the
 * branded (team, seat) composite. Only cells with problems appear in the map —
 * a column with no errors has no entry in the outer map.
 */
export type ValidationErrors = Map<number, Map<TeamSeat, ValidationCode[]>>

/**
 * Validate all cells and return a per-column map of (team, seat) → codes.
 * Only cells with problems appear in the result.
 */
export function validateCells(
  cellData: CellValue[][][],
  cols: Column[],
  greyResult: GreyedOutResult,
  noJumps?: boolean[],
  otEligibleTeams?: Set<number>,
  orphanedColumns?: Set<number>,
  emptySeats?: Set<string>,
): ValidationErrors {
  const errors: ValidationErrors = new Map()
  const teamCount = cellData.length

  function addError(teamIdx: number, seatIdx: number, colIdx: number, code: ValidationCode) {
    let col = errors.get(colIdx)
    if (!col) {
      col = new Map()
      errors.set(colIdx, col)
    }
    const key = teamSeatKey(toTeamIdx(teamIdx), toSeatIdx(seatIdx))
    const existing = col.get(key)
    if (existing) {
      existing.push(code)
    } else {
      col.set(key, [code])
    }
  }

  // Track per-seat running counts for out detection (left-to-right)
  // qCorrects[teamIdx][seatIdx], qErrors[teamIdx][seatIdx], qFouls[teamIdx][seatIdx]
  const qCorrects: number[][] = cellData.map((team) => new Array(team.length).fill(0))
  const qErrors: number[][] = cellData.map((team) => new Array(team.length).fill(0))
  const qFouls: number[][] = cellData.map((team) => new Array(team.length).fill(0))

  for (let colIdx = 0; colIdx < cols.length; colIdx++) {
    const col = cols[colIdx]!

    // Collect which teams have answers (non-foul) on this column
    const teamsWithAnswers: { teamIdx: number; seatIdx: number }[] = []

    for (let teamIdx = 0; teamIdx < teamCount; teamIdx++) {
      const seatCount = cellData[teamIdx]!.length
      const teamAnswers: { teamIdx: number; seatIdx: number }[] = []

      for (let seatIdx = 0; seatIdx < seatCount; seatIdx++) {
        const v = cellData[teamIdx]![seatIdx]![colIdx]!
        if (v === CellValue.Empty) continue

        // --- Empty seat ---
        if (emptySeats?.has(`${teamIdx}:${seatIdx}`)) {
          addError(teamIdx, seatIdx, colIdx, ValidationCode.EmptySeat)
        }

        // --- Column not active (orphaned) ---
        if (orphanedColumns?.has(colIdx)) {
          addError(teamIdx, seatIdx, colIdx, ValidationCode.QuestionNotNeeded)
        }

        // --- Not in overtime ---
        if (
          col.isOvertime &&
          otEligibleTeams &&
          !otEligibleTeams.has(teamIdx) &&
          v !== CellValue.Foul
        ) {
          addError(teamIdx, seatIdx, colIdx, ValidationCode.NotInOvertime)
        }

        // --- No-jump (fouls are still valid on no-jump columns) ---
        if (noJumps?.[colIdx] && v !== CellValue.Foul) {
          addError(teamIdx, seatIdx, colIdx, ValidationCode.NoJump)
        }

        // --- Wrong cell type ---
        if (col.type === QuestionType.B) {
          // B columns: only B/MB/F allowed
          if (v === CellValue.Correct || v === CellValue.Error) {
            addError(teamIdx, seatIdx, colIdx, ValidationCode.IsBonus)
          }
        } else {
          // Non-B columns: check bonus situation for this team
          const isBonus = isBonusSituation(greyResult.tossedUp, teamIdx, colIdx, teamCount)

          // B/MB only valid if it's a bonus situation
          if ((v === CellValue.Bonus || v === CellValue.MissedBonus) && !isBonus) {
            addError(teamIdx, seatIdx, colIdx, ValidationCode.NotBonus)
          }
          // C/E invalid if it IS a bonus situation (should be B/MB)
          if ((v === CellValue.Correct || v === CellValue.Error) && isBonus) {
            addError(teamIdx, seatIdx, colIdx, ValidationCode.IsBonus)
          }
        }

        // --- Quizzer out ---
        // Check BEFORE updating counts: if already out, flag appropriately
        const isQuizzedOut = qCorrects[teamIdx]![seatIdx]! >= 4
        const isErrorOut = qErrors[teamIdx]![seatIdx]! >= 3
        const isFoulOut = qFouls[teamIdx]![seatIdx]! >= 3
        if ((isErrorOut || isFoulOut) && v !== CellValue.Foul) {
          // Error/foul out: must leave, can't answer anything (except fouls)
          addError(teamIdx, seatIdx, colIdx, ValidationCode.QuizzerOut)
        } else if (
          isQuizzedOut &&
          v !== CellValue.Foul &&
          v !== CellValue.Bonus &&
          v !== CellValue.MissedBonus
        ) {
          // Quiz out: stays on bench, can still answer bonus (B/MB) but not C/E
          addError(teamIdx, seatIdx, colIdx, ValidationCode.QuizzerOut)
        }

        // Update running counts for this seat
        if (v === CellValue.Correct && !col.isOvertime) {
          qCorrects[teamIdx]![seatIdx]!++
        } else if (v === CellValue.Error && !col.isOvertime) {
          qErrors[teamIdx]![seatIdx]!++
        } else if (v === CellValue.Foul && !col.isOvertime) {
          qFouls[teamIdx]![seatIdx]!++
        }

        // --- Fouled on question (can't answer sub-parts) ---
        if (
          greyResult.fouledQuizzers[colIdx]?.has(
            teamSeatKey(toTeamIdx(teamIdx), toSeatIdx(seatIdx)),
          )
        ) {
          addError(teamIdx, seatIdx, colIdx, ValidationCode.FouledOnQuestion)
        }

        // --- Tossed up / wrong team bonus ---
        if (isAnswer(v) && greyResult.tossedUp[colIdx]?.has(toTeamIdx(teamIdx))) {
          // Check if some other team has a bonus situation on this column
          let isBonusForOther = false
          for (let otherTeamIdx = 0; otherTeamIdx < teamCount; otherTeamIdx++) {
            if (
              otherTeamIdx !== teamIdx &&
              isBonusSituation(greyResult.tossedUp, otherTeamIdx, colIdx, teamCount)
            ) {
              isBonusForOther = true
              break
            }
          }
          addError(
            teamIdx,
            seatIdx,
            colIdx,
            isBonusForOther ? ValidationCode.WrongTeamBonus : ValidationCode.WrongTeamTossUp,
          )
        }

        // --- Question resolved (A/B cascade) ---
        if (isAnswer(v)) {
          if (greyResult.colStatuses[colIdx] === ColStatus.Skipped) {
            addError(teamIdx, seatIdx, colIdx, ValidationCode.QuestionNotNeeded)
          }

          teamAnswers.push({ teamIdx, seatIdx })
        }
      }

      // --- Duplicate answers (same team, same column) ---
      if (teamAnswers.length > 1) {
        for (const { teamIdx: t, seatIdx: s } of teamAnswers) {
          addError(t, s, colIdx, ValidationCode.DuplicateAnswer)
        }
      }

      teamsWithAnswers.push(...teamAnswers)
    }

    // --- Multiple teams with answers on same column ---
    const uniqueTeams = new Set(teamsWithAnswers.map(({ teamIdx }) => teamIdx))
    if (uniqueTeams.size > 1) {
      for (const { teamIdx, seatIdx } of teamsWithAnswers) {
        addError(teamIdx, seatIdx, colIdx, ValidationCode.DuplicateAnswer)
      }
    }
  }

  return errors
}
