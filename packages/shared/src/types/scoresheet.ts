import { BonusRule, CellValue, PlacementFormula, QuestionCategory, QuizFormat } from '../quizFile'

export { BonusRule, CellValue, PlacementFormula, QuestionCategory, QuizFormat }

/** Sub-column kind within a question (Normal / A / B). Distinct from `QuestionCategory`. */
export enum QuestionType {
  Normal = '',
  A = 'A',
  B = 'B',
}

/**
 * Encodes both rank and tie-width for placement points lookup.
 * 1 = solo 1st, 1.2 = two-way tie for 1st, 1.3 = three-way tie for 1st,
 * 2 = solo 2nd, 2.2 = two-way tie for 2nd, 3 = solo 3rd.
 */
export type PlaceKey = 1 | 1.2 | 1.3 | 2 | 2.2 | 3

export interface Quiz {
  id: number
  division: string
  quizNumber: string
  /** Whether overtime is enabled */
  overtime: boolean
  /** Whether this quiz is in the consolation bracket */
  consolation: boolean
  placementFormula: PlacementFormula
  bonusRule: BonusRule
  /** Set when the quiz is created; never changed afterwards. Default 20-question */
  format: QuizFormat
  /** Question category per column key (e.g. "1" → INT, "16A" → FTV) */
  questionTypes: Map<string, QuestionCategory>
}

import type { QuizzerId } from './indices'
import { firstOvertimeQuestion, type QuizRules } from '../scoring/quizRules'

export interface Team {
  id: number
  quizId: number
  name: string
  onTime: boolean
  seatOrder: number
}

export interface Quizzer {
  /** Stable identity. Survives substitutions — answers are keyed by this. */
  id: QuizzerId
  teamId: number
  name: string
  seatOrder: number
}

export interface Answer {
  quizzerId: QuizzerId
  columnKey: string
  value: CellValue
}

/** All columns in the scoresheet grid */
export interface Column {
  /** Unique key like "1", "16A", "21" (meaning depends on the quiz format) */
  key: string
  /** Display label for the header */
  label: string
  /** The question number */
  number: number
  /** Normal / A / B sub-part */
  type: QuestionType
  /** Is this an A/B eligible column (from the format's first A/B question, and overtime)? */
  isAB: boolean
  /** Do error-point rules apply (from the format's first error-points question, and overtime)? */
  isErrorPoints: boolean
  /** Is this an overtime column (after the format's last regulation question)? */
  isOvertime: boolean
}

export interface Timeout {
  afterColumnKey: string | null
}

export const MAX_TIMEOUTS_PER_TEAM = 2

export const QUIZZERS_PER_TEAM = 5

/** Build the ordered list of question columns for a quiz format */
export function buildColumns(rules: QuizRules, overtimeRounds = 0): Column[] {
  const cols: Column[] = []

  function pushQuestion(n: number, isAB: boolean, isErrorPoints: boolean, isOvertime: boolean) {
    const types = isAB
      ? [QuestionType.Normal, QuestionType.A, QuestionType.B]
      : [QuestionType.Normal]
    for (const type of types) {
      cols.push({
        key: `${n}${type}`,
        label: `${n}${type}`,
        number: n,
        type,
        isAB,
        isErrorPoints,
        isOvertime,
      })
    }
  }

  for (let n = 1; n <= rules.regulationQuestions; n++) {
    pushQuestion(n, n >= rules.firstAbQuestion, n >= rules.firstErrorPointsQuestion, false)
  }

  // Overtime questions (with A/B parts), only as many rounds as requested
  const firstOt = firstOvertimeQuestion(rules)
  const otQuestions = Math.max(0, overtimeRounds) * rules.overtimeRoundSize
  for (let n = firstOt; n < firstOt + otQuestions; n++) {
    pushQuestion(n, true, true, true)
  }

  return cols
}

/** Build a key→index lookup map for a column list */
export function buildKeyToIdx(cols: Column[]): Map<string, number> {
  return new Map(cols.map((col, i) => [col.key, i]))
}
