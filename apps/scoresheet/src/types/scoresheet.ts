export enum CellValue {
  Correct = 'c',
  Error = 'e',
  Foul = 'f',
  Bonus = 'b',
  MissedBonus = 'mb',
  Empty = '',
}

export enum QuestionType {
  Normal = '',
  A = 'A',
  B = 'B',
}

export enum QuestionCategory {
  INT = 'INT',
  FTV = 'FTV',
  REF = 'REF',
  MA = 'MA',
  Q = 'Q',
  SIT = 'SIT',
}

/**
 * Encodes both rank and tie-width for placement points lookup.
 * 1 = solo 1st, 1.2 = two-way tie for 1st, 1.3 = three-way tie for 1st,
 * 2 = solo 2nd, 2.2 = two-way tie for 2nd, 3 = solo 3rd.
 */
export type PlaceKey = 1 | 1.2 | 1.3 | 2 | 2.2 | 3

export enum PlacementFormula {
  /** Official rulebook: 1st=score/10, 2nd=score/10−1, 3rd=score/10−2; friendly ties */
  Rules = 'rules',
  /** Pre-2023 spreadsheet formula: 1st=score/10+2, 2nd=score/10, 3rd=score/10−1 */
  Legacy = 'legacy',
}

export enum BonusRule {
  Team = 'team',
  Seat = 'seat',
}

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
  /** Question category per column key (e.g. "1" → INT, "16A" → FTV) */
  questionTypes: Map<string, QuestionCategory>
}

import type { QuizzerId } from './indices'

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
  /** Unique key like "1", "16A", "21" */
  key: string
  /** Display label for the header */
  label: string
  /** The question number (1–35) */
  number: number
  /** Normal / A / B sub-part */
  type: QuestionType
  /** Is this an A/B eligible column (questions 16–20, overtime)? */
  isAB: boolean
  /** Do error-point rules apply (questions 17–20, overtime)? */
  isErrorPoints: boolean
  /** Is this an overtime column (21+)? */
  isOvertime: boolean
}

export interface Timeout {
  afterColumnKey: string | null
}

export const MAX_TIMEOUTS_PER_TEAM = 2

export const QUIZZERS_PER_TEAM = 5

/** Build the ordered list of question columns */
export function buildColumns(overtimeRounds = 0): Column[] {
  const cols: Column[] = []

  // Questions 1-15: normal only
  for (let n = 1; n <= 15; n++) {
    cols.push({
      key: `${n}`,
      label: `${n}`,
      number: n,
      type: QuestionType.Normal,
      isAB: false,
      isErrorPoints: false,
      isOvertime: false,
    })
  }

  // Questions 16-20: normal + A + B
  for (let n = 16; n <= 20; n++) {
    const isErrorPoints = n >= 17
    cols.push({
      key: `${n}`,
      label: `${n}`,
      number: n,
      type: QuestionType.Normal,
      isAB: true,
      isErrorPoints,
      isOvertime: false,
    })
    cols.push({
      key: `${n}A`,
      label: `${n}A`,
      number: n,
      type: QuestionType.A,
      isAB: true,
      isErrorPoints,
      isOvertime: false,
    })
    cols.push({
      key: `${n}B`,
      label: `${n}B`,
      number: n,
      type: QuestionType.B,
      isAB: true,
      isErrorPoints,
      isOvertime: false,
    })
  }

  // Overtime questions (with A/B parts) — only as many as requested
  const otQuestions = Math.max(0, overtimeRounds) * 3
  for (let n = 21; n <= 20 + otQuestions; n++) {
    cols.push({
      key: `${n}`,
      label: `${n}`,
      number: n,
      type: QuestionType.Normal,
      isAB: true,
      isErrorPoints: true,
      isOvertime: true,
    })
    cols.push({
      key: `${n}A`,
      label: `${n}A`,
      number: n,
      type: QuestionType.A,
      isAB: true,
      isErrorPoints: true,
      isOvertime: true,
    })
    cols.push({
      key: `${n}B`,
      label: `${n}B`,
      number: n,
      type: QuestionType.B,
      isAB: true,
      isErrorPoints: true,
      isOvertime: true,
    })
  }

  return cols
}

/** Build a key→index lookup map for a column list */
export function buildKeyToIdx(cols: Column[]): Map<string, number> {
  return new Map(cols.map((col, i) => [col.key, i]))
}
