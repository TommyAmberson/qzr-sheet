import { editDistance, foldName, quizName, resultKey, tidyName } from '../results'
import { scheduleQuizMeta } from '../schedule/conflicts'
import type { ScheduleDocument, ScheduleQuiz } from '../schedule/scheduleFile'
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
  /** The meet's roster has no team in the quiz's division, so its division name doesn't resolve */
  | { kind: 'divisionNotOnRoster' }

/** A quiz that doesn't agree with the scheduled quiz it is linked to, or with its stage */
export type ScheduleProblem =
  /** In a meet with a published schedule, a quiz linked to none of its quizzes */
  | { kind: 'notLinked' }
  | { kind: 'nameDiffers'; scheduled: string }
  | { kind: 'teamsDiffer'; scheduled: string[] }
  /** An elimination or Finals that ended level with no overtime, where there must be a winner */
  | { kind: 'tieLeftStanding' }
  /** Overtime played in a prelim or an intermediate of a meet that plays them without it */
  | { kind: 'overtimePlayed' }

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

/**
 * A quiz of the schedule as stored quizzes are held against it. The schedule names a quiz's teams
 * where every seat is a letter of the draw; a seat filled from a rank or another quiz's result is
 * not known from the schedule alone, and such a quiz is matched on its name.
 */
export function scheduledQuizOf(
  doc: ScheduleDocument,
  quiz: ScheduleQuiz,
  /** A meet's team by its id, for a schedule linked to the meet */
  teamOf: (teamId: number) => Pick<RosterTeam, 'name' | 'shortName'> | undefined,
): ScheduledQuiz {
  const meta = scheduleQuizMeta(quiz)
  const drawn = doc.draw[quiz.division]?.teams ?? []
  const teams: Pick<RosterTeam, 'name' | 'shortName'>[] = []
  let known = true
  for (const seat of quiz.seats) {
    if (seat.kind === 'empty') continue
    const team = seat.kind === 'letter' ? drawn.find((t) => t.letter === seat.letter) : undefined
    const named =
      team?.teamId !== undefined
        ? teamOf(team.teamId)
        : team?.name
          ? { name: team.name, shortName: team.name }
          : undefined
    if (named) teams.push(named)
    else known = false
  }
  return { key: resultKey(meta), name: quizName(meta), teams: known ? teams : null }
}

/** A team of a quiz, with the quizzers it names */
interface SeatedTeam {
  name: string
  quizzers: { name: string }[]
}

/**
 * The teams that played: a team with no name and no quizzer named is the empty seat of a two-team
 * quiz, not a team. One with no name and quizzers named is a team the roster doesn't know.
 */
export function playing<Team extends SeatedTeam>(teams: Team[]): Team[] {
  return teams.filter(
    (team) => tidyName(team.name) !== '' || team.quizzers.some((q) => tidyName(q.name) !== ''),
  )
}

/** Whether a quiz's teams are the scheduled quiz's, each named outright, in any seats */
function sameTeams(teams: SeatedTeam[], scheduled: Pick<RosterTeam, 'name' | 'shortName'>[]) {
  const played = playing(teams)
  if (played.length !== scheduled.length) return false
  const left = [...scheduled]
  for (const team of played) {
    const match = teamNamed(team.name, left)
    if (!match) return false
    left.splice(left.indexOf(match), 1)
  }
  return true
}

/** What a stored quiz is held against, beside the quiz itself */
export interface QuizHeld {
  stage: Stage | null
  /** The quiz's own name, as a result key */
  key: string
  linked: ScheduledQuiz | null
  /** The division's teams with their quizzers, or null for a meet with no roster */
  roster: RosterTeam[] | null
  /** Whether the meet has a published schedule, so that every quiz should be one of its quizzes */
  schedulePublished: boolean
  /** Whether the meet plays its prelims and intermediates without overtime, a tie standing */
  prelimsWithoutOvertime: boolean
}

/**
 * How a quiz disagrees with the scheduled quiz it is linked to and with its stage. On an unlinked
 * quiz the differences are no error: they are why it did not link itself.
 */
export function scheduleProblems(
  scored: ScoredQuiz,
  { stage, key, linked, schedulePublished, prelimsWithoutOvertime }: Omit<QuizHeld, 'roster'>,
): ScheduleProblem[] {
  const problems: ScheduleProblem[] = []
  if (!linked && schedulePublished) problems.push({ kind: 'notLinked' })
  if (linked) {
    if (key !== linked.key) problems.push({ kind: 'nameDiffers', scheduled: linked.name })
    if (linked.teams !== null && !sameTeams(scored.teams, linked.teams)) {
      problems.push({ kind: 'teamsDiffer', scheduled: linked.teams.map((team) => team.name) })
    }
  }
  // Prelims and intermediates may end level; a quiz that seats the next one, or the Finals, may not
  const mustHaveWinner = stage === 'elimination' || stage === 'finals'
  if (mustHaveWinner && scored.teams.some((t) => t.place !== null && placeTieCount(t.place) > 1)) {
    problems.push({ kind: 'tieLeftStanding' })
  }
  // Where a tie stands, overtime changes who places where, so the quiz isn't what was played for
  const tieStands = stage === 'prelim' || stage === 'intermediate'
  if (tieStands && prelimsWithoutOvertime && scored.overtimePlayed) {
    problems.push({ kind: 'overtimePlayed' })
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
  // One problem, not one for every team, when the division itself is what doesn't match
  if (teams.length === 0) return [{ kind: 'divisionNotOnRoster' }]
  const problems: RosterProblem[] = []
  for (const team of playing(scored.teams)) {
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
export function quizProblems(scored: ScoredQuiz, held: QuizHeld): QuizProblem[] {
  return [
    ...scored.problems,
    ...rosterProblems(scored, held.roster),
    ...scheduleProblems(scored, held),
  ]
}
