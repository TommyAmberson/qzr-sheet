import type { DivisionStateValue, MeetPhase } from '../phases'
import { foldName, tidyName } from '../results'
import { computePlacementPoints } from '../scoring/placement'
import type { QuizOutcome } from '../scoring/quizOutcome'
import { divisionStandings, type TieBreak } from '../scoring/standings'
import type { ScoredQuiz, ScoredTeam, ScoringProblem } from './scoredQuiz'

/** What a stored quiz counts for */
export const STAGES = ['prelim', 'intermediate', 'elimination', 'finals'] as const
export type Stage = (typeof STAGES)[number]

/** A stored quiz, as a warning or a list names it */
export interface QuizRef {
  id: number
  name: string
}

/** What is wrong with a stored quiz; any one keeps it out of every table until fixed or accepted */
export type QuizProblem = ScoringProblem

export interface QuizResult {
  name: string
  /** `underReview` carries team names only: no places, no scores */
  status: 'counted' | 'underReview'
  teams: { name: string; place?: 1 | 2 | 3; tiedWith?: number; score?: number }[]
  /** For admins: the stored quiz's id, and what is wrong with it */
  id?: number
  problems?: QuizProblem[]
}

export interface StageResults {
  stage: Stage
  /** How much each quiz below carries */
  level: 'places' | 'scores'
  quizzes: QuizResult[]
}

export interface TeamTable {
  state: 'livePreview' | 'lockedIn'
  /** With `livePreview`: how many of the stage's quizzes it covers */
  covers?: { counted: number; scheduled: number | null }
  teams: {
    name: string
    rank: number
    placementPoints: number
    quizzes: number
    tied: boolean
    decidedBy: TieBreak | null
    finalist?: boolean
    /** The quizzes behind the totals */
    lines: {
      quiz: string
      stage: Stage
      place: number | null
      score: number
      placementPoints: number | null
      errors: number
    }[]
  }[]
}

export type StatsWarning =
  | { kind: 'inError'; quiz: QuizRef; problems: QuizProblem[] }
  | { kind: 'unequalPrelims'; division: string; teams: { name: string; quizzes: number }[] }
  | { kind: 'lookAlikeTeams'; division: string; names: [string, string] }
  /** Teams tied across the finalist cutoff, which the admin settles away from the app */
  | { kind: 'finalTie'; division: string; teams: string[] }

export interface DivisionStats {
  division: string
  state: DivisionStateValue
  phase: MeetPhase
  /** One entry for each stage that has a quiz, newest stage first */
  results: StageResults[]
  prelimStandings?: TeamTable
  /** Admins only */
  warnings?: StatsWarning[]
}

/** A stored quiz of the division, with what was kept of its current revision */
export interface StatsQuiz extends QuizRef {
  /** Null for a quiz that is not counted */
  stage: Stage | null
  scored: ScoredQuiz
}

export interface DivisionStatsInput {
  division: string
  state: DivisionStateValue
  phase: MeetPhase
  quizzes: StatsQuiz[]
}

/**
 * A division's stats as an admin sees them, from its stored quizzes as scored when they were saved.
 * Nothing is scored here: places and scores are read, and placement points are worked out from
 * each team's place and score before overtime.
 */
export function divisionStats(input: DivisionStatsInput): DivisionStats {
  const { division, state, phase } = input
  const staged = input.quizzes
    .filter((quiz): quiz is StatsQuiz & { stage: Stage } => quiz.stage !== null)
    .sort((a, b) => byNumber.compare(a.name, b.name))
  const warnings: StatsWarning[] = staged
    .filter(({ scored }) => scored.problems.length > 0)
    .map(({ id, name, scored }) => ({
      kind: 'inError',
      quiz: { id, name },
      problems: scored.problems,
    }))

  const results = [...STAGES]
    .reverse()
    .map((stage): StageResults => {
      const quizzes = staged.filter((quiz) => quiz.stage === stage)
      return { stage, level: 'scores', quizzes: quizzes.map(quizResult) }
    })
    .filter((stage) => stage.quizzes.length > 0)

  const prelims = staged.filter((quiz) => quiz.stage === 'prelim' && counts(quiz))
  const standings = divisionStandings(
    prelims.map(({ name, scored }) => ({ name, outcome: outcomeOf(scored) })),
  )
  for (const warning of standings.warnings) {
    if (warning.kind === 'unequalQuizCounts') {
      warnings.push({
        kind: 'unequalPrelims',
        division,
        teams: standings.teams.map(({ name, quizzes }) => ({ name, quizzes })),
      })
    } else if (warning.kind === 'lookAlike') {
      warnings.push({ kind: 'lookAlikeTeams', division, names: warning.teams })
    } else if (warning.kind === 'finalTie') {
      warnings.push({ kind: 'finalTie', division, teams: warning.teams })
    }
  }

  const prelimStandings: TeamTable = {
    state: 'livePreview',
    covers: { counted: prelims.length, scheduled: null },
    teams: standings.teams.map((team) => ({
      ...team,
      lines: prelims.flatMap(({ name, stage, scored }) =>
        scored.teams
          .filter((scoredTeam) => foldName(scoredTeam.name) === foldName(team.name))
          .map((scoredTeam) => ({
            quiz: name,
            stage,
            place: scoredTeam.place === null ? null : Math.floor(scoredTeam.place),
            score: scoredTeam.score,
            placementPoints: placementPointsOf(scoredTeam, scored),
            errors: scoredTeam.errors,
          })),
      ),
    })),
  }

  return { division, state, phase, results, prelimStandings, warnings }
}

/** Quiz names in the order people count them: Q2 before Q10 */
const byNumber = new Intl.Collator('en', { numeric: true })

/** Whether a quiz adds to the tables: one in error adds nothing */
function counts(quiz: StatsQuiz): boolean {
  return quiz.scored.problems.length === 0
}

function placementPointsOf(team: ScoredTeam, scored: ScoredQuiz): number | null {
  return computePlacementPoints(team.regulationScore, team.place, scored.formula)
}

/** A scored quiz as the standings take it */
function outcomeOf(scored: ScoredQuiz): QuizOutcome {
  return {
    placed: true,
    teams: scored.teams.map((team) => ({
      name: team.name,
      score: team.score,
      place: team.place,
      placementPoints: placementPointsOf(team, scored),
      errors: team.errors,
    })),
  }
}

function quizResult(quiz: StatsQuiz): QuizResult {
  const named = quiz.scored.teams.filter((team) => tidyName(team.name) !== '')
  if (!counts(quiz)) {
    return {
      name: quiz.name,
      status: 'underReview',
      teams: named.map((team) => ({ name: tidyName(team.name) })),
      id: quiz.id,
      problems: quiz.scored.problems,
    }
  }
  return {
    name: quiz.name,
    status: 'counted',
    teams: named.map((team) => {
      // A place key's fraction is how many teams share the place: 1.2 is a two-way tie for first
      const place = team.place === null ? undefined : (Math.floor(team.place) as 1 | 2 | 3)
      const tiedWith = team.place === null ? 0 : Math.round((team.place % 1) * 10)
      return {
        name: tidyName(team.name),
        ...(place ? { place } : {}),
        ...(tiedWith ? { tiedWith } : {}),
        score: team.score,
      }
    }),
    id: quiz.id,
  }
}
