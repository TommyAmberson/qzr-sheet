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

export interface Question {
  number: number
  type: QuestionType
}

export interface Answer {
  quizzerId: number
  questionId: string
  value: CellValue
}

export interface Quizzer {
  id: number
  name: string
  teamId: number
}

export interface Team {
  id: number
  name: string
  onTime: boolean
  timeouts: number[]
  quizzers: Quizzer[]
}

export interface QuizMeta {
  division: number
  quizNumber: number
  overtime: boolean
}

/** All columns in the scoresheet grid */
export interface Column {
  /** Unique key like "1", "16A", "21" */
  key: string
  /** Display label for the header */
  label: string
  /** The question number (1-26) */
  number: number
  /** Normal / A / B sub-part */
  type: QuestionType
  /** Is this an A/B eligible column (questions 16-20)? */
  isAB: boolean
  /** Do error-point rules apply (questions 17-20, 21-26)? */
  isErrorPoints: boolean
  /** Is this an overtime column (21-26)? */
  isOvertime: boolean
}

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

  // Questions 21-26: overtime (with A/B parts)
  for (let n = 21; n <= 26; n++) {
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
