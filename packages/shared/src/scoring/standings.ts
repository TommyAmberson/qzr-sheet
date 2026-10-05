import { editDistance, foldName, tidyName } from '../results'
import type { QuizOutcome, TeamOutcome } from './quizOutcome'

/** A counted quiz of the division, as the standings take it */
export interface CountedQuiz {
  /** How a warning names the quiz */
  name: string
  outcome: QuizOutcome
}

/** The tie-breaker that separated a team from the others level with it on placement points */
export type TieBreak = 'headToHead' | 'points' | 'errors'

export interface TeamStanding {
  name: string
  placementPoints: number
  /** Counted quizzes the team was placed in */
  quizzes: number
  /** Teams still tied after every tie-breaker share a rank */
  rank: number
  decidedBy: TieBreak | null
  tied: boolean
  finalist: boolean
}

export type StandingsWarning =
  /** Teams have played different numbers of counted quizzes; their counts are on the teams */
  | { kind: 'unequalQuizCounts' }
  | { kind: 'unplaced'; quiz: string }
  /** Teams tied across the finalist cutoff, which the admin settles away from the app */
  | { kind: 'finalTie'; teams: string[] }
  /** Two names that look like one team misspelt (R11), the higher ranked first */
  | { kind: 'lookAlike'; teams: [string, string] }

export interface DivisionStandings {
  teams: TeamStanding[]
  warnings: StandingsWarning[]
}

/** Teams per division that quiz the final */
const FINALISTS = 3

interface Tally {
  /** How often each spelling of the name was used, in the order first seen */
  spellings: Map<string, number>
  placementPoints: number
  quizzes: number
  points: number
  errors: number
  /** Counted quizzes in which this team finished above each other team, by team */
  above: Map<Tally, number>
}

/** A rank's teams: one, or several still tied after every tie-breaker */
interface RankGroup {
  tallies: Tally[]
  decidedBy: TieBreak | null
}

/**
 * A division's teams ranked by placement points over its counted quizzes, ties broken by the
 * rulebook's tie-breakers for prelim positions: head-to-head, then total points, then fewest
 * errors. Whenever a tie-breaker separates some of the tied teams, those still tied start again
 * from head-to-head among themselves.
 */
export function divisionStandings(quizzes: CountedQuiz[]): DivisionStandings {
  const tallies = new Map<string, Tally>()
  const warnings: StandingsWarning[] = []

  for (const quiz of quizzes) {
    if (!quiz.outcome.placed) {
      warnings.push({ kind: 'unplaced', quiz: quiz.name })
      continue
    }
    // A team with no name is an empty seat, as in a two-team quiz, not a team to rank
    const seated = quiz.outcome.teams
      .filter((team) => tidyName(team.name) !== '')
      .map((team) => ({ team, tally: tallyOf(tallies, team.name) }))
    for (const { team, tally } of seated) {
      tally.placementPoints += team.placementPoints ?? 0
      tally.quizzes += 1
      tally.points += team.score
      tally.errors += team.errors
      for (const other of seated) {
        if (finishedAbove(team, other.team)) {
          tally.above.set(other.tally, (tally.above.get(other.tally) ?? 0) + 1)
        }
      }
    }
  }

  const groups = levels([...tallies.values()], (t) => t.placementPoints).flatMap((level) =>
    breakTie(level),
  )
  const teams: TeamStanding[] = []
  for (const { tallies: tied, decidedBy } of groups) {
    const rank = teams.length + 1
    const finalist = teams.length + tied.length <= FINALISTS
    if (!finalist && teams.length < FINALISTS) {
      warnings.push({ kind: 'finalTie', teams: tied.map(nameOf) })
    }
    for (const tally of tied) {
      teams.push({
        name: nameOf(tally),
        placementPoints: tally.placementPoints,
        quizzes: tally.quizzes,
        rank,
        decidedBy,
        tied: tied.length > 1,
        finalist,
      })
    }
  }

  if (new Set(teams.map((t) => t.quizzes)).size > 1) warnings.push({ kind: 'unequalQuizCounts' })
  teams.forEach((team, i) => {
    for (const other of teams.slice(i + 1)) {
      if (looksAlike(team.name, other.name)) {
        warnings.push({ kind: 'lookAlike', teams: [team.name, other.name] })
      }
    }
  })
  return { teams, warnings }
}

/** A name's last word when it tells one church's teams apart: a number or a letter ("Calgary 2", "Regina B") */
const TEAM_MARK = /(?:^|\s)(\d+|[a-z])$/

/**
 * Whether two teams' names look like one team misspelt (R11): within one edit of each other once
 * folded, or two when both are at least six characters long. Names ending in different numbers or
 * letters are different teams, as one church's "Calgary 1" and "Calgary 2" are.
 */
function looksAlike(name: string, other: string): boolean {
  const [a, b] = [foldName(name), foldName(other)]
  const [markA, markB] = [TEAM_MARK.exec(a)?.[1], TEAM_MARK.exec(b)?.[1]]
  if (markA !== undefined && markB !== undefined && markA !== markB) return false
  return editDistance(a, b) <= (Math.min(a.length, b.length) >= 6 ? 2 : 1)
}

function tallyOf(tallies: Map<string, Tally>, name: string): Tally {
  const key = foldName(name)
  let tally = tallies.get(key)
  if (!tally) {
    tally = {
      spellings: new Map(),
      placementPoints: 0,
      quizzes: 0,
      points: 0,
      errors: 0,
      above: new Map(),
    }
    tallies.set(key, tally)
  }
  const spelling = tidyName(name)
  tally.spellings.set(spelling, (tally.spellings.get(spelling) ?? 0) + 1)
  return tally
}

/** The most-used spelling, a tie going to the one seen first */
function nameOf(tally: Tally): string {
  let best = ''
  let bestCount = 0
  for (const [spelling, count] of tally.spellings) {
    if (count > bestCount) [best, bestCount] = [spelling, count]
  }
  return best
}

/** Whether one team finished a quiz above another; teams sharing a place are level */
function finishedAbove(team: TeamOutcome, other: TeamOutcome): boolean {
  return (
    team.place !== null && other.place !== null && Math.floor(team.place) < Math.floor(other.place)
  )
}

/** Teams split into groups level on a value, highest value first, keeping their order within */
function levels(tallies: Tally[], value: (tally: Tally) => number): Tally[][] {
  const groups = new Map<number, Tally[]>()
  for (const tally of tallies) {
    const key = value(tally)
    const group = groups.get(key) ?? []
    group.push(tally)
    groups.set(key, group)
  }
  return [...groups].sort(([a], [b]) => b - a).map(([, group]) => group)
}

const AFTER_HEAD_TO_HEAD: [TieBreak, (tally: Tally) => number][] = [
  ['points', (t) => t.points],
  ['errors', (t) => -t.errors],
]

/**
 * Orders teams level on placement points into ranks, by the tie-breakers in turn. `by` is the
 * tie-breaker that set these teams apart from the rest, credited to a team it leaves on its own.
 */
function breakTie(tied: Tally[], by: TieBreak | null = null): RankGroup[] {
  if (tied.length === 1) return [{ tallies: tied, decidedBy: by }]
  const leader = headToHeadLeader(tied)
  if (leader) {
    return [
      { tallies: [leader], decidedBy: 'headToHead' },
      ...breakTie(
        tied.filter((t) => t !== leader),
        'headToHead',
      ),
    ]
  }
  for (const [criterion, value] of AFTER_HEAD_TO_HEAD) {
    const split = levels(tied, value)
    if (split.length > 1) return split.flatMap((group) => breakTie(group, criterion))
  }
  return [{ tallies: tied, decidedBy: null }]
}

/**
 * The tied team that finished above each of the others in more of their shared counted quizzes
 * than it finished below them, if there is one
 */
function headToHeadLeader(tied: Tally[]): Tally | undefined {
  return tied.find((team) =>
    tied.every(
      (other) => other === team || (team.above.get(other) ?? 0) > (other.above.get(team) ?? 0),
    ),
  )
}
