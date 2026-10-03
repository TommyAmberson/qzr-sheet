import {
  deserialize,
  foldName,
  quizName,
  quizOutcome,
  serialize,
  type CountedQuiz,
  type QuizFile,
  type TeamOutcome,
} from '@qzr/shared'
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

/** The names the quick form can change in a stored quiz's file; what's left out stays as it is */
export interface QuizEdit {
  division?: string
  quizNumber?: string
  /** By team id */
  teamNames?: Map<number, string>
  /** By quizzer id */
  quizzerNames?: Map<number, string>
}

/**
 * A stored quiz's file with its names changed, read and written through the shared codec so the
 * result is a file the scoresheet saves. The one place names in stored files are edited.
 */
export function editQuizFile(file: QuizFile, edit: QuizEdit): QuizFile {
  const content = deserialize(file)
  return serialize({
    ...content,
    quiz: {
      ...content.quiz,
      division: edit.division?.trim() ?? content.quiz.division,
      quizNumber: edit.quizNumber?.trim() ?? content.quiz.quizNumber,
    },
    teams: content.teams.map((team) => ({
      ...team,
      name: edit.teamNames?.get(team.id)?.trim() ?? team.name,
    })),
    quizzers: content.quizzers.map((quizzer) => ({
      ...quizzer,
      name: edit.quizzerNames?.get(quizzer.id)?.trim() ?? quizzer.name,
    })),
  })
}

/**
 * The edits merging one team name into another across a division (R10): each stored quiz of the
 * division, as written, with a team named `from` once folded for case and spaces, that team renamed
 * `into`. Every other name, and every other quiz, is left as it is.
 */
export function mergeEdits(
  stored: StoredQuiz[],
  division: string,
  from: string,
  into: string,
): { id: number; quizFile: QuizFile }[] {
  const merged = foldName(from)
  return stored.flatMap(({ id, quizFile }) => {
    if (quizFile.quiz.division !== division) return []
    const renamed = quizFile.teams.filter((team) => foldName(team.name) === merged)
    if (renamed.length === 0) return []
    const teamNames = new Map(renamed.map((team) => [team.id, into]))
    return [{ id, quizFile: editQuizFile(quizFile, { teamNames }) }]
  })
}
