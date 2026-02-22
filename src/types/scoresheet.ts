export enum CellValue {
  Correct = 'c',
  Error = 'e',
  Foul = 'f',
  Bonus = 'b',
  MissedBonus = 'mb',
  Empty = '',
}

export enum QuestionPart {
  Normal = '',
  A = 'A',
  B = 'B',
}

/** Column definition for a single question slot */
export interface QuestionColumn {
  /** Question number 1-26 */
  number: number
  part: QuestionPart
}

/** Build a string key like "4", "16A", "18B" */
export function questionKey(col: QuestionColumn): string {
  return `${col.number}${col.part}`
}

export interface Quizzer {
  id: number
  name: string
}

export interface Team {
  id: number
  name: string
  onTime: boolean
  /** Question numbers where timeouts were called */
  timeouts: number[]
  quizzers: Quizzer[]
}

export interface QuizMeta {
  division: number
  quizNumber: number
  overtime: boolean
}

/**
 * Map of "teamId:quizzerId:questionKey" → CellValue
 * e.g. "0:1:4" → CellValue.Correct
 *      "2:0:18A" → CellValue.Error
 */
export type CellMap = Record<string, CellValue>

export function cellKey(teamIdx: number, quizzerIdx: number, qKey: string): string {
  return `${teamIdx}:${quizzerIdx}:${qKey}`
}

export interface Scoresheet {
  meta: QuizMeta
  teams: Team[]
  cells: CellMap
}

// ── Column layout helpers ──────────────────────────────────────────

/** Normal questions 1-15 */
export const NORMAL_QUESTIONS: QuestionColumn[] = Array.from({ length: 15 }, (_, i) => ({
  number: i + 1,
  part: QuestionPart.Normal,
}))

/** Questions 16-20 each have Normal / A / B columns */
export const AB_QUESTIONS: QuestionColumn[] = [16, 17, 18, 19, 20].flatMap((n) => [
  { number: n, part: QuestionPart.Normal },
  { number: n, part: QuestionPart.A },
  { number: n, part: QuestionPart.B },
])

/** Overtime questions 21-26 each have Normal / A / B columns */
export const OVERTIME_QUESTIONS: QuestionColumn[] = [21, 22, 23, 24, 25, 26].flatMap((n) => [
  { number: n, part: QuestionPart.Normal },
  { number: n, part: QuestionPart.A },
  { number: n, part: QuestionPart.B },
])

/** Every column in order */
export const ALL_QUESTIONS: QuestionColumn[] = [
  ...NORMAL_QUESTIONS,
  ...AB_QUESTIONS,
  ...OVERTIME_QUESTIONS,
]

export const QUIZZERS_PER_TEAM = 5
export const TEAMS_COUNT = 3
