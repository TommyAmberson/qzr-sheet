import {
  byNumber,
  computePlacementPoints,
  deserialize,
  foldName,
  quizName,
  quizOutcome,
  sameDivision,
  scoreStoredQuiz,
  serialize,
  type QuizFile,
  type QuizOutcome,
  type TeamOutcome,
} from '@qzr/shared'
import type { StoredQuiz } from './api'

export interface ResultRow {
  id: number
  /** "D1 Q3", or "D1c Q3" in consolation */
  name: string
  /** In seat order, with each team's score and, once placed, its place and placement points */
  teams: TeamOutcome[]
  placed: boolean
  stage: StoredQuiz['stage']
  stageFrom: StoredQuiz['stageFrom']
  link: StoredQuiz['link']
  problems: StoredQuiz['problems']
  accepted: boolean
  revision: number
  action: StoredQuiz['action']
  savedBy: string
  savedAt: string
}

export interface DivisionResults {
  division: string
  quizzes: ResultRow[]
}

/**
 * A quiz accepted as scored, placed by its scores whatever its errors, as the standings take it.
 * Placement points follow the quiz's own formula, as for any other quiz on this page.
 */
function acceptedOutcome(file: QuizFile): QuizOutcome {
  const scored = scoreStoredQuiz(file)
  return {
    placed: scored.teams.every((team) => team.place !== null),
    teams: scored.teams.map((team) => ({
      name: team.name,
      score: team.score,
      place: team.place,
      placementPoints: computePlacementPoints(
        team.regulationScore,
        team.place,
        file.quiz.placementFormula,
      ),
      errors: team.errors,
    })),
  }
}

/** A meet's stored quizzes grouped by the division each one records, as written */
export function groupResults(stored: StoredQuiz[]): DivisionResults[] {
  const divisions = new Map<string, ResultRow[]>()
  for (const s of stored) {
    const content = deserialize(s.quizFile)
    const outcome = s.accepted ? acceptedOutcome(s.quizFile) : quizOutcome(content)
    const row: ResultRow = {
      id: s.id,
      name: quizName(content.quiz),
      teams: outcome.teams,
      placed: outcome.placed,
      stage: s.stage,
      stageFrom: s.stageFrom,
      link: s.link,
      problems: s.problems,
      accepted: s.accepted,
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
 * The edits merging one name into another across a division (R10, FR-031): each stored quiz of the
 * division, as written, with a team named `from` once folded for case and spaces renamed `into`, or
 * given `team`, a quizzer of that team named `from` renamed `into`. Every other name, and every
 * other quiz, is left as it is.
 */
export function mergeEdits(
  stored: StoredQuiz[],
  division: string,
  from: string,
  into: string,
  team?: string,
): { id: number; quizFile: QuizFile }[] {
  const merged = foldName(from)
  // The stats that raised the look-alike name the division as the meet lists it
  return stored.flatMap(({ id, quizFile }) => {
    if (!sameDivision(quizFile.quiz.division, division)) return []
    if (team === undefined) {
      const renamed = quizFile.teams.filter((t) => foldName(t.name) === merged)
      if (renamed.length === 0) return []
      const teamNames = new Map(renamed.map((t) => [t.id, into]))
      return [{ id, quizFile: editQuizFile(quizFile, { teamNames }) }]
    }
    const renamed = quizFile.teams
      .filter((t) => foldName(t.name) === foldName(team))
      .flatMap((t) => t.quizzers.filter((quizzer) => foldName(quizzer.name) === merged))
    if (renamed.length === 0) return []
    const quizzerNames = new Map(renamed.map((quizzer) => [quizzer.id, into]))
    return [{ id, quizFile: editQuizFile(quizFile, { quizzerNames }) }]
  })
}
