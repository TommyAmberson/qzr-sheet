/** Cell result types */
export type CellValue = 'c' | 'e' | 'f' | 'b' | 'mb' | '' | null

/** A single quizzer row in the scoresheet */
export interface QuizzerRow {
  /** Seat number 1-5 */
  seat: number
  /** Quizzer full name */
  name: string
  /** Results per question, keyed like "q1", "q2", ..., "q16", ..., "q21" */
  [question: string]: CellValue | string | number
}

/** A team block in the scoresheet */
export interface TeamBlock {
  teamName: string
  onTime: boolean
  timeouts: number[]
  quizzers: QuizzerRow[]
}

/** Full quiz metadata */
export interface QuizMeta {
  division: number
  quizNumber: number
  overtime: boolean
}

/** Flat row for AG Grid rendering */
export interface GridRow {
  /** Row type for styling/logic */
  rowType: 'teamHeader' | 'quizzer' | 'teamScore'
  /** Display in the first column */
  label: string
  /** Team index (0-2) for team-related rows */
  teamIndex?: number
  /** Seat number for quizzer rows */
  seat?: number
  /** Question values keyed by column field */
  [question: string]: CellValue | string | number | undefined
}

/** Question column definition helper */
export interface QuestionDef {
  field: string
  headerName: string
  /** Question region for styling */
  region: 'normal' | 'ab' | 'overtime'
  /** The question number */
  questionNumber: number
}

/**
 * Generate all question column definitions.
 * Normal:   q1..q15   (15 columns)
 * A/B:      q16..q20  (5 columns — one per question, A/B tracked in cell)
 * Overtime: q21..q26  (6 columns)
 */
export function getQuestionDefs(): QuestionDef[] {
  const defs: QuestionDef[] = []

  // Normal questions 1-15
  for (let i = 1; i <= 15; i++) {
    defs.push({
      field: `q${i}`,
      headerName: `${i}`,
      region: 'normal',
      questionNumber: i,
    })
  }

  // A/B questions 16-20 (single column each, A/B in header)
  for (let i = 16; i <= 20; i++) {
    defs.push({
      field: `q${i}`,
      headerName: `${i}`,
      region: 'ab',
      questionNumber: i,
    })
  }

  // Overtime questions 21-26
  for (let i = 21; i <= 26; i++) {
    defs.push({
      field: `q${i}`,
      headerName: `${i}`,
      region: 'overtime',
      questionNumber: i,
    })
  }

  return defs
}

/** All question field names in order */
export const QUESTION_FIELDS = getQuestionDefs().map((d) => d.field)
