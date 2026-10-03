import { deserialize, quizOutcome, type TeamOutcome } from '@qzr/shared'
import type { StoredQuiz } from './api'

export interface ResultRow {
  id: number
  quizNumber: string
  room: string | null
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
      quizNumber: content.quiz.quizNumber,
      room: s.roomName,
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
      quizzes: quizzes.sort((a, b) => byNumber.compare(a.quizNumber, b.quizNumber)),
    }))
}
