import { editDistance, foldName, resultKey, tidyName } from '../results'
import { placeTieCount } from '../scoring/placement'
import type { ScoredQuiz, ScoringProblem } from './scoredQuiz'
import type { Stage } from './stages'
import { teamNamed, teamsNearName, type RosterTeam } from './teamNames'

/** A name of the quiz that doesn't agree with the roster of its division */
export type RosterProblem =
  /** `team` is empty for a team left unnamed; `near` is the roster team it is closest to */
  | { kind: 'teamNotOnRoster'; team: string; near?: string }
  | { kind: 'quizzerNotOnRoster'; team: string; quizzer: string; near?: string }
  /** A quizzer of the team's roster the quiz doesn't list */
  | { kind: 'quizzerMissing'; team: string; quizzer: string }
  | { kind: 'tooManyQuizzers'; team: string; listed: number; roster: number }

/** A quiz that doesn't agree with the scheduled quiz it is linked to, or with its stage */
export type ScheduleProblem =
  | { kind: 'nameDiffers'; scheduled: string }
  | { kind: 'teamsDiffer'; scheduled: string[] }
  /** An elimination or Finals that ended level with no overtime, where there must be a winner */
  | { kind: 'tieLeftStanding' }

/** What is wrong with a stored quiz; any one keeps it out of every table until fixed or accepted */
export type QuizProblem = ScoringProblem | RosterProblem | ScheduleProblem

/** The scheduled quiz a stored quiz is held against */
export interface ScheduledQuiz {
  /** Its name as a result key (`resultName`) and as people read it */
  key: string
  name: string
  /** The teams the schedule gives it, or null where it doesn't name them yet */
  teams: Pick<RosterTeam, 'name' | 'shortName'>[] | null
}

/** A quiz's name and teams, as they are held against a scheduled quiz */
export interface NamedQuiz {
  quiz: { division: string; consolation?: boolean; quizNumber: string }
  teams: { name: string }[]
}

/**
 * Whether a quiz says which quiz it is. A division or quiz number left blank is none, and so is
 * `_`, which the scoresheet shows for a blank and writes into file names.
 */
export function isNamed(quiz: NamedQuiz['quiz']): boolean {
  return [quiz.division, quiz.quizNumber].every((part) => !['', '_'].includes(part.trim()))
}

/** Whether a quiz's teams are the scheduled quiz's, each named outright, in any seats */
function sameTeams(teams: { name: string }[], scheduled: Pick<RosterTeam, 'name' | 'shortName'>[]) {
  const named = teams.filter((team) => tidyName(team.name) !== '')
  if (named.length !== teams.length || named.length !== scheduled.length) return false
  const left = [...scheduled]
  for (const team of named) {
    const match = teamNamed(team.name, left)
    if (!match) return false
    left.splice(left.indexOf(match), 1)
  }
  return true
}

/**
 * Whether a quiz is a scheduled quiz, by its name and, where the schedule names them, its teams,
 * compared ignoring case, spacing and punctuation. `near` is a quiz of that name that misses only
 * by a slightly different team name: not a match, but worth offering.
 */
export function matchScheduledQuiz(
  quiz: NamedQuiz,
  scheduled: ScheduledQuiz,
): 'match' | 'near' | 'no' {
  if (!isNamed(quiz.quiz) || resultKey(quiz.quiz) !== scheduled.key) return 'no'
  if (scheduled.teams === null || sameTeams(quiz.teams, scheduled.teams)) return 'match'
  const left = [...scheduled.teams]
  for (const team of quiz.teams) {
    const match = teamNamed(team.name, left) ?? teamsNearName(team.name, left)[0]
    if (!match) return 'no'
    left.splice(left.indexOf(match), 1)
  }
  return left.length === 0 ? 'near' : 'no'
}

/**
 * How a quiz disagrees with the scheduled quiz it is linked to and with its stage. On an unlinked
 * quiz the differences are no error: they are why it did not link itself.
 */
export function scheduleProblems(
  scored: ScoredQuiz,
  stage: Stage | null,
  quiz: NamedQuiz['quiz'],
  linked: ScheduledQuiz | null,
): ScheduleProblem[] {
  const problems: ScheduleProblem[] = []
  if (linked) {
    if (resultKey(quiz) !== linked.key)
      problems.push({ kind: 'nameDiffers', scheduled: linked.name })
    if (linked.teams !== null && !sameTeams(scored.teams, linked.teams)) {
      problems.push({ kind: 'teamsDiffer', scheduled: linked.teams.map((team) => team.name) })
    }
  }
  // Prelims and intermediates may end level; a quiz that seats the next one, or the Finals, may not
  const mustHaveWinner = stage === 'elimination' || stage === 'finals'
  if (mustHaveWinner && scored.teams.some((t) => t.place !== null && placeTieCount(t.place) > 1)) {
    problems.push({ kind: 'tieLeftStanding' })
  }
  return problems
}

/** The roster name a typed name is nearest to, when it is near enough to be a slip of it */
function nearest(typed: string, names: string[]): string | undefined {
  const folded = foldName(typed)
  let best: string | undefined
  let bestDistance = Math.max(2, Math.floor(folded.length / 3)) + 1
  for (const name of names) {
    const distance = editDistance(folded, foldName(name))
    if (distance < bestDistance) [best, bestDistance] = [name, distance]
  }
  return best
}

/**
 * How a quiz's names disagree with the roster of its division: the meet's teams of that division
 * with their quizzers. A team matches by its full or short name, ignoring case, spacing and
 * punctuation; a quizzer by name, ignoring case and spacing. `teams` is null for a meet with no
 * roster, which has no roster errors.
 */
export function rosterProblems(scored: ScoredQuiz, teams: RosterTeam[] | null): RosterProblem[] {
  if (teams === null) return []
  const problems: RosterProblem[] = []
  for (const team of scored.teams) {
    const rosterTeam = teamNamed(team.name, teams)
    if (!rosterTeam) {
      const near = teamsNearName(team.name, teams)[0]?.name
      problems.push({
        kind: 'teamNotOnRoster',
        team: tidyName(team.name),
        ...(near ? { near } : {}),
      })
      continue
    }
    // A team whose roster has not been entered has nothing to hold its quizzers against
    if (rosterTeam.quizzers.length === 0) continue
    const onRoster = new Set(rosterTeam.quizzers.map(foldName))
    const listed = new Set(team.quizzers.map((quizzer) => foldName(quizzer.name)))
    const missing = rosterTeam.quizzers.filter((name) => !listed.has(foldName(name)))
    for (const quizzer of team.quizzers) {
      if (onRoster.has(foldName(quizzer.name))) continue
      const near = nearest(quizzer.name, missing)
      problems.push({
        kind: 'quizzerNotOnRoster',
        team: rosterTeam.name,
        quizzer: tidyName(quizzer.name),
        ...(near ? { near } : {}),
      })
    }
    if (team.quizzers.length > rosterTeam.quizzers.length) {
      problems.push({
        kind: 'tooManyQuizzers',
        team: rosterTeam.name,
        listed: team.quizzers.length,
        roster: rosterTeam.quizzers.length,
      })
    }
    for (const quizzer of missing) {
      problems.push({ kind: 'quizzerMissing', team: rosterTeam.name, quizzer })
    }
  }
  return problems
}

/** Everything wrong with a stored quiz: what the quiz alone shows, then its roster, then its schedule */
export function quizProblems(
  scored: ScoredQuiz,
  held: {
    stage: Stage | null
    quiz: NamedQuiz['quiz']
    linked: ScheduledQuiz | null
    roster: RosterTeam[] | null
  },
): QuizProblem[] {
  return [
    ...scored.problems,
    ...rosterProblems(scored, held.roster),
    ...scheduleProblems(scored, held.stage, held.quiz, held.linked),
  ]
}
