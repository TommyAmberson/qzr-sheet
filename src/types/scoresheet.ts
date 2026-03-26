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

export enum PlacementFormula {
  /** Official rulebook: 1st=score/10, 2nd=score/10−1, 3rd=score/10−2 */
  Rules = 'rules',
  /** Legacy spreadsheet: 1st=score/10+2, 2nd=score/10, 3rd=score/10−1 */
  Spreadsheet = 'spreadsheet',
}

export interface Quiz {
  id: number
  division: string
  quizNumber: string
  /** Whether overtime is enabled */
  overtime: boolean
  placementFormula: PlacementFormula
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
