import type { DivisionStateValue, MeetPhase } from '../phases'
import { byNumber, foldName, tidyName } from '../results'
import { computePlacementPoints, placeKey, placeRank, placeTieCount } from '../scoring/placement'
import { quizzerStandings, type QuizzerList } from '../scoring/quizzerStandings'
import { divisionStandings, type CountedQuiz, type TieBreak } from '../scoring/standings'
import { playing, quizProblems, type QuizProblem, type ScheduledQuiz } from './quizProblems'
import type { ScoredQuiz, ScoredTeam } from './scoredQuiz'
import { STAGES, type Stage } from './stages'
import { teamNamed, type RosterTeam } from './teamNames'

/** A stored quiz, as a warning or a list names it */
export interface QuizRef {
  id: number
  name: string
}

export interface QuizResult {
  name: string
  /**
   * `accepted` is a quiz in error that an admin accepted as scored, which counts. `underReview` is
   * one in error and not accepted: it carries team names only, no places and no scores.
   */
  status: 'counted' | 'accepted' | 'underReview'
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
  /** The Finals stage only: the first three of each bracket that has one decided Finals */
  medals?: { consolation: boolean; teams: [string, string, string] }[]
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

/** The stages that count for individuals: every one but the Finals */
const QUIZZER_STAGES = ['prelim', 'intermediate', 'elimination'] as const

export interface QuizzerTable {
  state: 'livePreview' | 'preview' | 'lockedIn'
  /** The last stage it covers */
  through: (typeof QUIZZER_STAGES)[number]
  /** The division's main list, then its consolation list where there is one */
  lists: QuizzerList[]
}

export type StatsWarning =
  | { kind: 'inError'; quiz: QuizRef; problems: QuizProblem[] }
  | { kind: 'unequalPrelims'; division: string; teams: { name: string; quizzes: number }[] }
  | { kind: 'lookAlikeTeams'; division: string; names: [string, string] }
  /** Teams tied across the finalist cutoff, which the admin settles away from the app */
  | { kind: 'finalTie'; division: string; teams: string[] }
  /** More than one Finals for a bracket, so none of them gives its first three */
  | { kind: 'twoFinals'; division: string; consolation: boolean; quizzes: QuizRef[] }

export interface DivisionStats {
  division: string
  state: DivisionStateValue
  phase: MeetPhase
  /** One entry for each stage that has a quiz, newest stage first */
  results: StageResults[]
  prelimStandings?: TeamTable
  /** The teams that played an intermediate, in their new order; absent where none did */
  rerank?: TeamTable
  quizzers?: QuizzerTable
  /** Admins only */
  warnings?: StatsWarning[]
}

/** A stored quiz of the division, with what was kept of its current revision */
export interface StatsQuiz extends QuizRef {
  /** Its own name as a result key, which a link's scheduled quiz is held against */
  key: string
  /** Null for a quiz that is not counted */
  stage: Stage | null
  scored: ScoredQuiz
  /** The scheduled quiz it is linked to */
  linked: ScheduledQuiz | null
  /** For an intermediate: the line of the schedule it is on, whose teams are re-ranked together */
  line?: number
  /** Whether an admin accepted its current content as scored */
  accepted: boolean
}

export interface DivisionStatsInput {
  division: string
  state: DivisionStateValue
  phase: MeetPhase
  quizzes: StatsQuiz[]
  /** The division's teams with their quizzers, or null for a meet with no roster */
  roster: RosterTeam[] | null
  /** Whether the schedule has an intermediate or an elimination quiz for the division */
  laterStagesScheduled: boolean
  /** Whether the meet has a published schedule: a quiz linked to none of its quizzes is in error */
  schedulePublished: boolean
}

/** A quiz with a stage, its names as the roster has them, and what is wrong with it */
interface Staged extends QuizRef {
  stage: Stage
  line: number
  scored: ScoredQuiz
  problems: QuizProblem[]
  /** Whether it adds to the tables: one in error does only once accepted */
  counts: boolean
}

/**
 * A division's stats as an admin sees them, from its stored quizzes as scored when they were saved.
 * Nothing is scored here: places and scores are read, and placement points are worked out from
 * each team's place and its score before overtime.
 */
export function divisionStats(input: DivisionStatsInput): DivisionStats {
  const { division, state, phase, roster } = input
  const staged = input.quizzes
    .filter((quiz): quiz is StatsQuiz & { stage: Stage } => quiz.stage !== null)
    .sort((a, b) => byNumber.compare(a.name, b.name))
    .map((quiz): Staged => {
      const problems = quizProblems(quiz.scored, {
        stage: quiz.stage,
        key: quiz.key,
        linked: quiz.linked,
        roster,
        schedulePublished: input.schedulePublished,
      })
      return {
        id: quiz.id,
        name: quiz.name,
        stage: quiz.stage,
        line: quiz.line ?? 0,
        scored: namedByRoster(placedAsTheyStand(quiz.scored), roster),
        problems,
        counts: problems.length === 0 || quiz.accepted,
      }
    })
  const counting = staged.filter((quiz) => quiz.counts)
  const ofStage = (stage: Stage) => counting.filter((quiz) => quiz.stage === stage)

  const warnings: StatsWarning[] = staged
    .filter((quiz) => !quiz.counts)
    .map(({ id, name, problems }) => ({ kind: 'inError', quiz: { id, name }, problems }))

  const results = [...STAGES]
    .reverse()
    .map((stage): StageResults => {
      const quizzes = staged.filter((quiz) => quiz.stage === stage)
      return { stage, level: 'scores', quizzes: quizzes.map(quizResult) }
    })
    .filter((stage) => stage.quizzes.length > 0)
  const finals = results.find((stage) => stage.stage === 'finals')
  if (finals) {
    finals.medals = []
    for (const consolation of [false, true]) {
      const bracket = ofStage('finals').filter((quiz) => quiz.scored.consolation === consolation)
      if (bracket.length > 1) {
        warnings.push({
          kind: 'twoFinals',
          division,
          consolation,
          quizzes: bracket.map(({ id, name }) => ({ id, name })),
        })
      }
      const medals = bracket.length === 1 ? firstThree(bracket[0]!.scored) : null
      if (medals) finals.medals.push({ consolation, teams: medals })
    }
  }

  const prelims = ofStage('prelim')
  const intermediates = ofStage('intermediate')
  // The top three are finalists only where the prelims lead straight to a Finals
  const leadsToFinals =
    !input.laterStagesScheduled &&
    !staged.some((quiz) => quiz.stage === 'intermediate' || quiz.stage === 'elimination')
  const standings = divisionStandings(prelims.map(counted), { finalists: leadsToFinals })
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
  const prelimLines = teamLines(prelims)
  const prelimStandings: TeamTable = {
    state: 'livePreview',
    covers: { counted: prelims.length, scheduled: null },
    teams: standings.teams.map(({ finalist, ...team }) => ({
      ...team,
      ...(leadsToFinals ? { finalist } : {}),
      lines: prelimLines.get(foldName(team.name)) ?? [],
    })),
  }

  const rerank = intermediates.length > 0 ? rerankOf(standings.teams, prelims, intermediates) : null

  // A Finals counts for nobody's average
  const individual = counting.filter(
    (quiz): quiz is Staged & { stage: QuizzerTable['through'] } => quiz.stage !== 'finals',
  )
  const quizzers: QuizzerTable = {
    state: 'livePreview',
    through:
      [...QUIZZER_STAGES]
        .reverse()
        .find((stage) => individual.some((quiz) => quiz.stage === stage)) ?? 'prelim',
    lists: quizzerStandings(
      individual.map(({ name, scored }) => ({
        name,
        consolation: scored.consolation,
        teams: scored.teams,
      })),
    ),
  }

  return {
    division,
    state,
    phase,
    results,
    prelimStandings,
    ...(rerank ? { rerank } : {}),
    quizzers,
    warnings,
  }
}

/**
 * A quiz with every team placed. Teams still level in an overtime not played out have no place;
 * such a quiz counts only once accepted as scored, and is then placed by its scores as they stand,
 * the level teams sharing the place.
 */
function placedAsTheyStand(scored: ScoredQuiz): ScoredQuiz {
  if (scored.teams.every((team) => team.place !== null)) return scored
  return {
    ...scored,
    teams: scored.teams.map((team) => {
      // A two-team quiz's empty seat has no place, and takes none from the teams that played
      const played = playing(scored.teams)
      if (!played.includes(team)) return team
      const above = played.filter((other) => other.score > team.score).length
      const level = played.filter((other) => other.score === team.score).length
      return { ...team, place: placeKey(above + 1, level) }
    }),
  }
}

/**
 * A scored quiz with each team and quizzer the roster has under the roster's name, so a team
 * written by its short name in one quiz and its full name in another is one team
 */
function namedByRoster(scored: ScoredQuiz, roster: RosterTeam[] | null): ScoredQuiz {
  if (roster === null) return scored
  return {
    ...scored,
    teams: scored.teams.map((team) => {
      const rosterTeam = teamNamed(team.name, roster)
      if (!rosterTeam) return team
      const spelling = new Map(rosterTeam.quizzers.map((name) => [foldName(name), name]))
      return {
        ...team,
        name: rosterTeam.name,
        quizzers: team.quizzers.map((quizzer) => ({
          ...quizzer,
          name: spelling.get(foldName(quizzer.name)) ?? quizzer.name,
        })),
      }
    }),
  }
}

function placementPointsOf(team: ScoredTeam, scored: ScoredQuiz): number | null {
  return computePlacementPoints(team.regulationScore, team.place, scored.formula)
}

/** A quiz that counts, as the standings take it */
function counted({ name, scored }: Staged): CountedQuiz {
  return {
    name,
    teams: scored.teams.map((team) => ({
      name: team.name,
      score: team.score,
      place: team.place,
      placementPoints: placementPointsOf(team, scored),
      errors: team.errors,
    })),
  }
}

/** The quizzes behind each team's total, by the team's folded name */
function teamLines(quizzes: Staged[]): Map<string, TeamTable['teams'][number]['lines']> {
  const linesOf = new Map<string, TeamTable['teams'][number]['lines']>()
  for (const { name, stage, scored } of quizzes) {
    for (const team of scored.teams) {
      const key = foldName(team.name)
      const lines = linesOf.get(key) ?? []
      lines.push({
        quiz: name,
        stage,
        place: team.place === null ? null : placeRank(team.place),
        score: team.score,
        placementPoints: placementPointsOf(team, scored),
        errors: team.errors,
      })
      linesOf.set(key, lines)
    }
  }
  return linesOf
}

/**
 * The teams that played an intermediate, re-ranked among themselves by their prelim placement
 * points plus their intermediate's, ties broken as the standings break them. The teams of one line
 * of the schedule are ranked together and take, in their new order, the prelim ranks they held
 * between them.
 */
function rerankOf(
  prelimTeams: { name: string; rank: number }[],
  prelims: Staged[],
  intermediates: Staged[],
): TeamTable {
  // A team's place in the prelim order, which tied teams hold one after the other, so teams an
  // intermediate separates take places of their own
  const position = new Map(prelimTeams.map((team, i) => [foldName(team.name), i + 1]))
  // A team with no prelim place takes one after every prelim team, in the order it is met
  let unplaced = prelimTeams.length
  const teams: TeamTable['teams'] = []
  for (const line of [...new Set(intermediates.map((quiz) => quiz.line))].sort((a, b) => a - b)) {
    const played = intermediates.filter((quiz) => quiz.line === line)
    const inLine = new Set(
      played.flatMap((quiz) => quiz.scored.teams.map((team) => foldName(team.name))),
    )
    const together = [...prelims, ...played]
    const lines = teamLines(together)
    // Ranked among the line's teams alone: their points from every quiz, and ties broken between
    // them, never against a team outside the line
    const order = divisionStandings(
      together.map(counted).map((quiz) => ({
        ...quiz,
        teams: quiz.teams.filter((team) => inLine.has(foldName(team.name))),
      })),
      { finalists: false },
    ).teams
    const held = order
      .map((team) => position.get(foldName(team.name)) ?? ++unplaced)
      .sort((a, b) => a - b)
    order.forEach(({ finalist: _finalist, ...team }, i) => {
      const before = order[i - 1]
      // Teams the re-rank leaves level share the place of the first of them
      const level = team.tied && before?.tied && before.rank === team.rank
      teams.push({
        ...team,
        rank: level ? teams[teams.length - 1]!.rank : held[i]!,
        lines: lines.get(foldName(team.name)) ?? [],
      })
    })
  }
  return { state: 'livePreview', teams }
}

/** A decided Finals' first, second and third; null where teams are level or a place is missing */
function firstThree(scored: ScoredQuiz): [string, string, string] | null {
  const named = scored.teams.filter((team) => tidyName(team.name) !== '')
  const at = (rank: number) =>
    named.filter(
      (team) =>
        team.place !== null && placeTieCount(team.place) === 1 && placeRank(team.place) === rank,
    )
  const [first, second, third] = [at(1), at(2), at(3)]
  if (first.length !== 1 || second.length !== 1 || third.length !== 1) return null
  return [tidyName(first[0]!.name), tidyName(second[0]!.name), tidyName(third[0]!.name)]
}

function quizResult(quiz: Staged): QuizResult {
  const named = quiz.scored.teams.filter((team) => tidyName(team.name) !== '')
  if (!quiz.counts) {
    return {
      name: quiz.name,
      status: 'underReview',
      teams: named.map((team) => ({ name: tidyName(team.name) })),
      id: quiz.id,
      problems: quiz.problems,
    }
  }
  return {
    name: quiz.name,
    status: quiz.problems.length > 0 ? 'accepted' : 'counted',
    teams: named.map((team) => {
      const place = team.place === null ? undefined : placeRank(team.place)
      const tiedWith = team.place === null ? 1 : placeTieCount(team.place)
      return {
        name: tidyName(team.name),
        ...(place ? { place } : {}),
        ...(tiedWith > 1 ? { tiedWith } : {}),
        score: team.score,
      }
    }),
    id: quiz.id,
    ...(quiz.problems.length > 0 ? { problems: quiz.problems } : {}),
  }
}
