import { foldName, tidyName } from '../results'
import { countSpelling, mostUsedSpelling } from './standings'

/** One quizzer's figures in one quiz, as scoring gives them: nothing from bonuses or overtime */
export interface QuizzerFigures {
  name: string
  points: number
  errors: number
  correct: number
  /** Correct answers by question type, for the questions whose type the quiz records */
  types: Record<string, number>
}

/** A quiz that counts for individuals */
export interface QuizzerQuiz {
  name: string
  /** A quiz of the division's consolation bracket */
  consolation: boolean
  teams: { name: string; quizzers: QuizzerFigures[] }[]
}

export type QuizzerFlag =
  /** Listed in fewer or more quizzes than their team played; the average is not changed for it */
  | { kind: 'quizCount'; listed: number; teamQuizzes: number }
  /** Their correct answers by type don't add up to their correct answers */
  | { kind: 'incompleteTypes' }

export interface QuizzerStanding {
  name: string
  team: string
  /** Quizzers level on average and errors share a place, and the next place is skipped */
  place: number
  /** Total points over the quizzes the quizzer's team played; exact, for ranking */
  average: number
  points: number
  errors: number
  /** Correct answers plus errors, outside overtime, bonus answers excluded */
  jumps: number
  /** The quizzes the quizzer's team played, which the average divides by */
  quizzes: number
  types: Record<string, number>
  /** The quizzes behind the totals */
  lines: {
    quiz: string
    points: number
    errors: number
    jumps: number
    types: Record<string, number>
  }[]
  flags: QuizzerFlag[]
}

export interface QuizzerList {
  /** The quizzers of teams that played in the consolation bracket, ranked apart */
  consolation: boolean
  quizzers: QuizzerStanding[]
}

interface TeamTally {
  spellings: Map<string, number>
  quizzes: number
  consolation: boolean
  quizzers: Map<string, QuizzerTally>
}

interface QuizzerTally {
  spellings: Map<string, number>
  lines: QuizzerStanding['lines']
}

function addTypes(into: Record<string, number>, types: Record<string, number>) {
  for (const [type, count] of Object.entries(types)) into[type] = (into[type] ?? 0) + count
}

/**
 * A division's quizzers ranked by average over the quizzes that count for individuals. A quizzer is
 * a name on a team, both compared ignoring case and spacing, so the same name on another team is
 * another quizzer. The average is total points over the quizzes the quizzer's team played, whether
 * or not the quizzer was listed in each; ranking is by the exact average, then fewest errors.
 * Quizzers of teams that played any consolation quiz are ranked apart, over every quiz their team
 * played. None of this is in the rulebook: see "Rules Not in the Rulebook" in
 * `docs/scoring-rules-explained.md`.
 */
export function quizzerStandings(
  quizzes: QuizzerQuiz[],
  /** `warnTypes` false for a meet that doesn't record question types: no quizzer is flagged for them */
  { warnTypes = true }: { warnTypes?: boolean } = {},
): QuizzerList[] {
  const teams = new Map<string, TeamTally>()
  for (const quiz of quizzes) {
    for (const team of quiz.teams) {
      // A team with no name is an empty seat, as in a two-team quiz
      if (tidyName(team.name) === '') continue
      const key = foldName(team.name)
      let tally = teams.get(key)
      if (!tally) {
        tally = { spellings: new Map(), quizzes: 0, consolation: false, quizzers: new Map() }
        teams.set(key, tally)
      }
      countSpelling(tally.spellings, team.name)
      tally.quizzes += 1
      tally.consolation ||= quiz.consolation
      for (const quizzer of team.quizzers) {
        const quizzerKey = foldName(quizzer.name)
        let quizzerTally = tally.quizzers.get(quizzerKey)
        if (!quizzerTally) {
          quizzerTally = { spellings: new Map(), lines: [] }
          tally.quizzers.set(quizzerKey, quizzerTally)
        }
        countSpelling(quizzerTally.spellings, quizzer.name)
        quizzerTally.lines.push({
          quiz: quiz.name,
          points: quizzer.points,
          errors: quizzer.errors,
          jumps: quizzer.correct + quizzer.errors,
          types: quizzer.types,
        })
      }
    }
  }

  const lists: QuizzerList[] = []
  for (const consolation of [false, true]) {
    const unranked = [...teams.values()]
      .filter((team) => team.consolation === consolation)
      .flatMap((team) =>
        [...team.quizzers.values()].map((quizzer): Omit<QuizzerStanding, 'place'> => {
          const types: Record<string, number> = {}
          let points = 0
          let errors = 0
          let jumps = 0
          for (const line of quizzer.lines) {
            points += line.points
            errors += line.errors
            jumps += line.jumps
            addTypes(types, line.types)
          }
          const typed = Object.values(types).reduce((sum, count) => sum + count, 0)
          const flags: QuizzerFlag[] = []
          if (quizzer.lines.length !== team.quizzes) {
            flags.push({
              kind: 'quizCount',
              listed: quizzer.lines.length,
              teamQuizzes: team.quizzes,
            })
          }
          if (warnTypes && typed !== jumps - errors) flags.push({ kind: 'incompleteTypes' })
          return {
            name: mostUsedSpelling(quizzer.spellings),
            team: mostUsedSpelling(team.spellings),
            average: points / team.quizzes,
            points,
            errors,
            jumps,
            quizzes: team.quizzes,
            types,
            lines: quizzer.lines,
            flags,
          }
        }),
      )
    if (unranked.length === 0) continue
    unranked.sort(
      (a, b) =>
        b.average - a.average ||
        a.errors - b.errors ||
        a.team.localeCompare(b.team) ||
        a.name.localeCompare(b.name),
    )
    const quizzers: QuizzerStanding[] = []
    unranked.forEach((quizzer, i) => {
      const above = quizzers[i - 1]
      const level = above && above.average === quizzer.average && above.errors === quizzer.errors
      // Level quizzers share the place of the first of them; the next takes its own position
      quizzers.push({ ...quizzer, place: level ? above.place : i + 1 })
    })
    lists.push({ consolation, quizzers })
  }
  return lists
}
