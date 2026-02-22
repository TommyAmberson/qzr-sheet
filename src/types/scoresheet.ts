export enum Answer {
  Correct = 'c',
  Error = 'e',
  Foul = 'f',
  Bonus = 'b',
  MissedBonus = 'mb',
  Empty = '',
}

/** Column key for addressing a specific cell: "3", "16", "16A", "16B" */
export type ColumnKey = string

export type QuestionPart = 'A' | 'B'

/** All column definitions in display order */
export interface ColumnDef {
  key: ColumnKey
  question: number
  part?: QuestionPart
  label: string
}

/**
 * Question flow for Q16-20 (and overtime Q21-26):
 *   Q16 = normal (all 3 teams jump)
 *     → correct: advance to Q17
 *     → error:  Q16A toss-up (2 remaining teams)
 *       → correct: advance to Q17
 *       → error:  Q16B bonus (1 remaining team, "b" or "mb")
 *         → then advance to Q17
 *
 * Q16 has A/B because all 3 teams must jump on Q17+.
 * Q17-20 are "error points" — same A/B toss-up/bonus flow.
 * Q21-26 are overtime — same A/B flow.
 */
export function buildColumns(): ColumnDef[] {
  const cols: ColumnDef[] = []

  // Questions 1-15: single column each
  for (let q = 1; q <= 15; q++) {
    cols.push({ key: `${q}`, question: q, label: `${q}` })
  }

  // Questions 16-26: base + A (toss-up) + B (bonus) columns each
  for (let q = 16; q <= 26; q++) {
    cols.push({ key: `${q}`, question: q, label: `${q}` })
    cols.push({ key: `${q}A`, question: q, part: 'A', label: `${q}A` })
    cols.push({ key: `${q}B`, question: q, part: 'B', label: `${q}B` })
  }

  return cols
}

export const SEATS_PER_TEAM = 5
export const TEAM_COUNT = 3

export interface QuizzerRow {
  seat: number
  name: string
  /** Answers keyed by ColumnKey */
  answers: Record<ColumnKey, Answer>
}

export interface TeamBlock {
  teamName: string
  onTime: boolean
  timeouts: number[]
  quizzers: QuizzerRow[]
}

export interface QuizMeta {
  division: number
  quizNumber: number
  overtime: boolean
}

export interface Scoresheet {
  meta: QuizMeta
  teams: [TeamBlock, TeamBlock, TeamBlock]
}

/** Create an empty quizzer row */
export function emptyQuizzer(seat: number): QuizzerRow {
  return { seat, name: '', answers: {} }
}

/** Create an empty team block */
export function emptyTeam(name = ''): TeamBlock {
  return {
    teamName: name,
    onTime: true,
    timeouts: [],
    quizzers: Array.from({ length: SEATS_PER_TEAM }, (_, i) => emptyQuizzer(i + 1)),
  }
}

/** Create a blank scoresheet */
export function emptyScoresheet(): Scoresheet {
  return {
    meta: { division: 1, quizNumber: 1, overtime: false },
    teams: [emptyTeam(), emptyTeam(), emptyTeam()],
  }
}
