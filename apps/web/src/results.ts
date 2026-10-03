import { deserialize, quizName, quizOutcome, type CountedQuiz, type TeamOutcome } from '@qzr/shared'
import type { StoredQuiz } from './api'

export interface ResultRow {
  id: number
  /** "D1 Q3", or "D1c Q3" in consolation */
  name: string
  /** The room that first submitted the quiz, as named then, or who uploaded it */
  from: string
  /** In seat order, with each team's score and, once placed, its place and placement points */
  teams: TeamOutcome[]
  placed: boolean
  counted: boolean
  revision: number
  action: StoredQuiz['action']
  savedBy: string
  savedAt: string
}

export interface DivisionResults {
  division: string
  quizzes: ResultRow[]
}

const byNumber = new Intl.Collator(undefined, { numeric: true })

/** A meet's stored quizzes grouped by the division each one records, as written */
export function groupResults(stored: StoredQuiz[]): DivisionResults[] {
  const divisions = new Map<string, ResultRow[]>()
  for (const s of stored) {
    const content = deserialize(s.quizFile)
    const outcome = quizOutcome(content)
    const row: ResultRow = {
      id: s.id,
      name: quizName(content.quiz),
      from: s.origin.action === 'uploaded' ? `Uploaded by ${s.origin.name}` : s.origin.name,
      teams: outcome.teams,
      placed: outcome.placed,
      counted: s.counted,
      revision: s.revision,
      action: s.action,
      savedBy: s.savedBy.name,
      savedAt: s.savedAt,
    }
    const rows = divisions.get(content.quiz.division) ?? []
    rows.push(row)
    divisions.set(content.quiz.division, rows)
  }
  return [...divisions]
    .sort(([a], [b]) => byNumber.compare(a, b))
    .map(([division, quizzes]) => ({
      division,
      quizzes: quizzes.sort((a, b) => byNumber.compare(a.name, b.name)),
    }))
}

/** A division's counted quizzes, as its standings take them */
export function countedQuizzes(division: DivisionResults): CountedQuiz[] {
  return division.quizzes
    .filter((quiz) => quiz.counted)
    .map((quiz) => ({ name: quiz.name, outcome: { placed: quiz.placed, teams: quiz.teams } }))
}
