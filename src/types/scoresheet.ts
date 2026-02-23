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

export interface Quiz {
  id: number
  division: number
  quizNumber: number
  /** Number of overtime rounds (0 = no overtime, each round = 3 questions) */
  overtimeRounds: number
}

export interface Team {
  id: number
  quizId: number
  name: string
  onTime: boolean
  seatOrder: number
}

export interface Quizzer {
  id: number
  teamId: number
  name: string
  seatOrder: number
}

export interface Answer {
  quizzerId: number
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

/** Maximum number of overtime rounds (each round = 3 questions) */
export const MAX_OVERTIME_ROUNDS = 5

/** Maximum number of overtime questions (MAX_OVERTIME_ROUNDS × 3) */
export const MAX_OVERTIME_QUESTIONS = MAX_OVERTIME_ROUNDS * 3

/** Build the ordered list of question columns */
export function buildColumns(): Column[] {
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

  // Questions 21-35: overtime (with A/B parts)
  // Pre-allocated for up to MAX_OVERTIME_ROUNDS rounds of 3 questions each.
  // Only visible columns are shown based on the overtimeRounds setting.
  for (let n = 21; n <= 20 + MAX_OVERTIME_QUESTIONS; n++) {
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

/** Static column list — built once, never changes */
export const COLUMNS = buildColumns()

/** Lookup column index by key (e.g. "1", "17A", "21B") */
export const KEY_TO_IDX = new Map<string, number>(
  COLUMNS.map((col, i) => [col.key, i]),
)
