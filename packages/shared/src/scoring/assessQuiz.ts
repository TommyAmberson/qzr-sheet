import type { BonusRule, CellValue, PlacementFormula } from '../quizFile'
import { MAX_TIMEOUTS_PER_TEAM } from '../types/scoresheet'
import type { Column, PlaceKey, Timeout } from '../types/scoresheet'
import { computeOrphanedColumns } from './columnVisibility'
import { computeGreyedOut, type GreyedOutResult } from './greyedOut'
import {
  computeOtCheckpointScores,
  computeOtIneligibility,
  computeOvertimeRounds,
  computeRegulationScores,
  getOvertimeEligibleTeams,
  questionsComplete,
} from './overtime'
import { computePlacementPoints, computePlacements } from './placement'
import { lastTimeoutQuestion, type QuizRules } from './quizRules'
import { validateCells, type ValidationErrors } from './validation'

export interface QuizAssessmentInput {
  cells: CellValue[][][]
  columns: Column[]
  rules: QuizRules
  noJumps: boolean[]
  /** Per team, in seat order */
  onTimes: boolean[]
  /** Whether the quiz goes to overtime on a tie */
  overtime: boolean
  bonusRule: BonusRule
  placementFormula: PlacementFormula
  /** "teamIdx:seatIdx" keys of seats with no quizzer named */
  emptySeats: Set<string>
  /** Per team, in seat order */
  timeouts: Timeout[][]
}

export interface QuizAssessment {
  /** Overtime rounds in play (0 for none) */
  visibleOtRounds: number
  greyedOut: GreyedOutResult
  orphanedColumns: Set<number>
  validationErrors: ValidationErrors
  /** Columns after which a timeout was called once error points had begun */
  timeoutErrorColumns: Set<number>
  /** The same, per team index */
  timeoutErrorsByTeam: Map<number, Set<number>>
  /** Teams with more timeouts than allowed */
  tooManyTimeoutsTeams: Set<number>
  hasErrors: boolean
  /** Per team; all null until regulation is complete with no errors */
  placements: (PlaceKey | null)[]
  /** Per team; null where there is no placement */
  placementPoints: (number | null)[]
}

/** Timeouts can be called between questions until error points begin */
export function isTimeoutAllowed(columnKey: string, rules: QuizRules): boolean {
  const num = parseInt(columnKey, 10)
  return !isNaN(num) && num <= lastTimeoutQuestion(rules)
}

/**
 * Validate a quiz and, once it can be placed, place it. The one place that decides whether a quiz
 * is placed: the scoresheet shows this result, and stored quizzes are scored by it.
 */
export function assessQuiz(input: QuizAssessmentInput): QuizAssessment {
  const { cells, columns, rules, noJumps, onTimes } = input

  const visibleOtRounds = input.overtime
    ? computeOvertimeRounds(cells, columns, onTimes, noJumps, rules)
    : 0
  const otIneligibility = computeOtIneligibility(cells, columns, onTimes, noJumps, rules)
  // Regulation-only eligibility: a team's OT answers are never invalid just because it was
  // resolved out later
  const otEligibleTeams = getOvertimeEligibleTeams(cells, columns, onTimes, rules)
  const greyedOut = computeGreyedOut(cells, columns, otIneligibility, input.bonusRule)
  const orphanedColumns = computeOrphanedColumns(
    cells,
    columns,
    noJumps,
    visibleOtRounds,
    rules,
    greyedOut.colStatuses,
  )
  const validationErrors = validateCells(
    cells,
    columns,
    greyedOut,
    rules,
    noJumps,
    otEligibleTeams,
    orphanedColumns,
    input.emptySeats,
  )

  const timeoutErrorColumns = new Set<number>()
  const timeoutErrorsByTeam = new Map<number, Set<number>>()
  const tooManyTimeoutsTeams = new Set<number>()
  input.timeouts.forEach((teamTimeouts, teamIdx) => {
    if (teamTimeouts.length > MAX_TIMEOUTS_PER_TEAM) tooManyTimeoutsTeams.add(teamIdx)
    for (const t of teamTimeouts) {
      if (t.afterColumnKey === null || isTimeoutAllowed(t.afterColumnKey, rules)) continue
      const colIdx = columns.findIndex((c) => c.key === t.afterColumnKey)
      if (colIdx < 0) continue
      timeoutErrorColumns.add(colIdx)
      let cols = timeoutErrorsByTeam.get(teamIdx)
      if (!cols) timeoutErrorsByTeam.set(teamIdx, (cols = new Set()))
      cols.add(colIdx)
    }
  })

  const hasErrors =
    validationErrors.size > 0 || timeoutErrorColumns.size > 0 || tooManyTimeoutsTeams.size > 0
  const regulationComplete = questionsComplete(
    cells,
    columns,
    noJumps,
    1,
    rules.regulationQuestions,
  )

  let placements = onTimes.map((): PlaceKey | null => null)
  let placementPoints = onTimes.map((): number | null => null)
  if (regulationComplete && !hasErrors) {
    const regScores = computeRegulationScores(cells, columns, onTimes, rules)
    placements = computePlacements(
      regScores,
      computeOtCheckpointScores(cells, columns, onTimes, noJumps, rules),
      true,
      visibleOtRounds > 0,
    )
    // Rules §1.e.4: on a tie, placement points use the end-of-regulation score, not OT
    placementPoints = placements.map((place, teamIdx) =>
      computePlacementPoints(regScores[teamIdx] ?? 0, place, input.placementFormula),
    )
  }

  return {
    visibleOtRounds,
    greyedOut,
    orphanedColumns,
    validationErrors,
    timeoutErrorColumns,
    timeoutErrorsByTeam,
    tooManyTimeoutsTeams,
    hasErrors,
    placements,
    placementPoints,
  }
}
