import type { DivisionStateValue, MeetPhase } from '../phases'
import { byNumber, foldName, tidyName } from '../results'
import {
  computePlacementPoints,
  computePlacements,
  placeRank,
  placeTieCount,
} from '../scoring/placement'
import {
  quizzerStandings,
  type QuizzerList,
  type QuizzerStanding,
} from '../scoring/quizzerStandings'
import {
  divisionStandings,
  type CountedQuiz,
  type TieBreak,
  type TieBreakOrder,
  looksAlike,
} from '../scoring/standings'
import type { PlacementFormula } from '../quizFile'
import type { PlacedTeam } from '../schedule/resolve'
import { playing, quizProblems, type QuizProblem, type ScheduledQuiz } from './quizProblems'
import type { ScoredQuiz } from './scoredQuiz'
import { QUIZZER_STAGES, type QuizzerStage, type StatsSettings } from './settings'
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
  teams: {
    name: string
    place?: 1 | 2 | 3
    tiedWith?: number
    score?: number
    /** For admins, in a quiz that counts: the placement points it gives and the team's errors */
    placementPoints?: number
    errors?: number
  }[]
  /** For admins: the stored quiz's id, and what is wrong with it */
  id?: number
  problems?: QuizProblem[]
  /** For admins: it was seated from an order since withdrawn, and no admin has kept it since */
  withdrawnOrder?: true
  /** For admins: a quizzer's correct answers by type don't add up (FR-007); not an error */
  incompleteTypes?: true
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
  teams: TeamRow[]
  /** For admins: the current order, where it no longer matches the confirmed one */
  current?: TeamRow[]
  /** Who confirmed the order shown, and when */
  confirmed?: { by: string; at: string }
}

/** An order an admin confirmed, as it stood then (FR-019b, FR-019c) */
export interface ConfirmedOrder {
  teams: TeamRow[]
  by: string
  at: string
}

export interface TeamRow {
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
    /** Left out for a viewer where the stage's results show places only */
    score?: number
    placementPoints: number | null
    /** Left out with `score`: errors show only with the full sheet */
    errors?: number
  }[]
}

export interface QuizzerTable {
  state: 'livePreview' | 'preview' | 'lockedIn'
  /** The last stage it covers */
  through: QuizzerStage
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
  /** The current order differs from the one the admin confirmed, which stands */
  | { kind: 'orderChanged'; division: string; what: 'prelims' | 'rerank' }
  /** A quiz seated from an order since withdrawn, until an admin keeps it or stops it counting */
  | { kind: 'withdrawnOrder'; quiz: QuizRef }
  /** Two quizzer names on one team that look like one quizzer misspelt */
  | { kind: 'lookAlikeQuizzers'; division: string; team: string; names: [string, string] }

/**
 * What needs an admin's attention (FR-030): a division's warnings, its quizzers listed in another
 * number of quizzes than their team played, its quizzes whose question types don't add up, and
 * what only the meet as a whole knows: stored quizzes with no stage, and quizzes scored another way
 */
export type AttentionItem =
  | StatsWarning
  | { kind: 'noStage'; quiz: QuizRef }
  | {
      kind: 'quizzerCount'
      division: string
      team: string
      quizzer: string
      listed: number
      teamQuizzes: number
      /** The team's quizzes the quizzer isn't listed in, most likely left off the sheet */
      missing: QuizRef[]
    }
  | { kind: 'incompleteTypes'; quiz: QuizRef }
  | { kind: 'otherFormula'; quizzes: QuizRef[] }

/** Two names an admin said are different: two teams, or with `team` two quizzers on that team */
export interface NameDismissal {
  /** Folded; empty for two team names */
  team: string
  /** Folded, in a fixed order */
  names: [string, string]
}

/** Two names as a dismissal holds them, so the same pair is the same dismissal whichever way round */
export function nameDismissal(team: string | null, names: [string, string]): NameDismissal {
  const [a, b] = names.map(foldName).sort() as [string, string]
  return { team: team === null ? '' : foldName(team), names: [a, b] }
}

/** A division's warnings and flags as items of what needs attention */
export function attentionOf(stats: DivisionStats): AttentionItem[] {
  const items: AttentionItem[] = [...(stats.warnings ?? [])]
  // The quizzes that count for a quizzer's average: every counting quiz but a Finals
  const individual = stats.results
    .filter((stage) => stage.stage !== 'finals')
    .flatMap((stage) => stage.quizzes)
    .filter((quiz) => quiz.status !== 'underReview' && quiz.id !== undefined)
  for (const list of stats.quizzers?.lists ?? []) {
    for (const quizzer of list.quizzers) {
      for (const flag of quizzer.flags) {
        if (flag.kind !== 'quizCount') continue
        const listedIn = new Set(quizzer.lines.map((line) => line.quiz))
        const missing = individual
          .filter(
            (quiz) =>
              !listedIn.has(quiz.name) &&
              quiz.teams.some((team) => foldName(team.name) === foldName(quizzer.team)),
          )
          .map((quiz) => ({ id: quiz.id!, name: quiz.name }))
        items.push({
          kind: 'quizzerCount',
          division: stats.division,
          team: quizzer.team,
          quizzer: quizzer.name,
          listed: flag.listed,
          teamQuizzes: flag.teamQuizzes,
          missing,
        })
      }
    }
  }
  for (const stage of stats.results) {
    for (const quiz of stage.quizzes) {
      if (quiz.incompleteTypes && quiz.id !== undefined) {
        items.push({ kind: 'incompleteTypes', quiz: { id: quiz.id, name: quiz.name } })
      }
    }
  }
  return items
}

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
  /** Whether it was seated from an order since withdrawn, and no admin has kept it since */
  withdrawnOrder?: boolean
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
  settings: Pick<StatsSettings, 'tieBreaks' | 'levelTeams' | 'prelimsWithoutOvertime'>
  /** The prelim order and the re-rank the admin confirmed, where they stand confirmed */
  confirmed?: { prelims?: ConfirmedOrder; rerank?: ConfirmedOrder }
  /**
   * The last stage quizzer standings cover, for standings that update by stage: the quizzes up to
   * the last step the admin confirmed, as they now stand (FR-018a). Every stage when left out.
   */
  quizzersThrough?: QuizzerStage
  /** Look-alike pairs an admin said are different names, which are not flagged again (FR-032) */
  dismissed?: NameDismissal[]
}

/** A quiz with a stage, its names as the roster has them, and what is wrong with it */
interface Staged extends QuizRef {
  stage: Stage
  line: number
  scored: ScoredQuiz
  problems: QuizProblem[]
  /** Whether it adds to the tables: one in error does only once accepted */
  counts: boolean
  withdrawnOrder: boolean
}

/**
 * The quizzes of a division that have a stage, each with whether it adds to the tables, without
 * working the tables out: what a division needs to know whether it is ready for its next step
 */
export function heldQuizzes(
  input: DivisionStatsInput,
): { id: number; stage: Stage; counts: boolean }[] {
  return stageQuizzes(input).map(({ id, stage, counts }) => ({ id, stage, counts }))
}

/**
 * The teams of each quiz of a division that counts, by its stored id, as the tables take them: the
 * places, ties and placement points the benches a quiz feeds are settled from (`resolveBenches`)
 */
export function countingTeams(input: DivisionStatsInput): Map<number, PlacedTeam[]> {
  const { levelTeams } = input.settings
  return new Map(
    stageQuizzes(input)
      .filter((quiz) => quiz.counts)
      .map((quiz) => [
        quiz.id,
        quiz.scored.teams
          .filter((team) => tidyName(team.name) !== '')
          .map((team) => ({
            name: tidyName(team.name),
            place: team.place,
            placementPoints:
              computePlacementPoints(team.regulationScore, team.place, levelTeams) ?? 0,
            score: team.score,
            errors: team.errors,
          })),
      ]),
  )
}

/** A division's quizzes with a stage, in the order people count them, held against everything */
function stageQuizzes(input: DivisionStatsInput): Staged[] {
  return input.quizzes
    .filter((quiz): quiz is StatsQuiz & { stage: Stage } => quiz.stage !== null)
    .sort((a, b) => byNumber.compare(a.name, b.name))
    .map((quiz): Staged => {
      const problems = quizProblems(quiz.scored, {
        stage: quiz.stage,
        key: quiz.key,
        linked: quiz.linked,
        roster: input.roster,
        schedulePublished: input.schedulePublished,
        prelimsWithoutOvertime: input.settings.prelimsWithoutOvertime,
      })
      return {
        id: quiz.id,
        name: quiz.name,
        stage: quiz.stage,
        line: quiz.line ?? 0,
        scored: namedByRoster(placedAsTheyStand(quiz.scored), input.roster),
        problems,
        counts: problems.length === 0 || quiz.accepted,
        withdrawnOrder: quiz.withdrawnOrder ?? false,
      }
    })
}

/**
 * A division's stats as an admin sees them, from its stored quizzes as scored when they were saved.
 * Nothing is scored here: places and scores are read, and placement points are worked out from
 * each team's place and its score before overtime.
 */
export function divisionStats(input: DivisionStatsInput): DivisionStats {
  const { division, state, phase, settings } = input
  const { tieBreaks, levelTeams } = settings
  const staged = stageQuizzes(input)
  const counting = staged.filter((quiz) => quiz.counts)
  const ofStage = (stage: Stage) => counting.filter((quiz) => quiz.stage === stage)

  const warnings: StatsWarning[] = [
    ...staged
      .filter((quiz) => !quiz.counts)
      .map(
        ({ id, name, problems }): StatsWarning => ({
          kind: 'inError',
          quiz: { id, name },
          problems,
        }),
      ),
    ...staged
      .filter((quiz) => quiz.withdrawnOrder)
      .map(({ id, name }): StatsWarning => ({ kind: 'withdrawnOrder', quiz: { id, name } })),
  ]

  const results = [...STAGES]
    .reverse()
    .map((stage): StageResults => {
      const quizzes = staged.filter((quiz) => quiz.stage === stage)
      return {
        stage,
        level: 'scores',
        quizzes: quizzes.map((quiz) => quizResult(quiz, levelTeams)),
      }
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
  const standings = divisionStandings(
    prelims.map((quiz) => counted(quiz, levelTeams)),
    { finalists: leadsToFinals, tieBreaks },
  )
  for (const warning of standings.warnings) {
    if (warning.kind === 'unequalQuizCounts') {
      warnings.push({
        kind: 'unequalPrelims',
        division,
        teams: standings.teams.map(({ name, quizzes }) => ({ name, quizzes })),
      })
    } else if (warning.kind === 'lookAlike') {
      if (!isDismissed(input.dismissed, null, warning.teams)) {
        warnings.push({ kind: 'lookAlikeTeams', division, names: warning.teams })
      }
    } else if (warning.kind === 'finalTie') {
      warnings.push({ kind: 'finalTie', division, teams: warning.teams })
    }
  }
  const prelimLines = teamLines(prelims, levelTeams)
  const prelimStandings = asConfirmed(
    {
      state: 'livePreview',
      covers: { counted: prelims.length, scheduled: null },
      teams: standings.teams.map(({ finalist, ...team }) => ({
        ...team,
        ...(leadsToFinals ? { finalist } : {}),
        lines: prelimLines.get(foldName(team.name)) ?? [],
      })),
    },
    input.confirmed?.prelims,
  )

  // The confirmed prelim order is what the re-rank starts from: it seated the intermediates
  const rerank =
    intermediates.length > 0
      ? asConfirmed(
          rerankOf(prelimStandings.teams, prelims, intermediates, levelTeams, tieBreaks),
          input.confirmed?.rerank,
        )
      : null
  for (const [what, table] of [
    ['prelims', prelimStandings],
    ['rerank', rerank],
  ] as const) {
    if (table?.current) warnings.push({ kind: 'orderChanged', division, what })
  }

  // A Finals counts for nobody's average, and standings by stage stop at the last step confirmed
  const lastStage = QUIZZER_STAGES.indexOf(input.quizzersThrough ?? 'elimination')
  const individual = counting.filter(
    (quiz): quiz is Staged & { stage: QuizzerStage } =>
      quiz.stage !== 'finals' && QUIZZER_STAGES.indexOf(quiz.stage) <= lastStage,
  )
  const quizzers: QuizzerTable = {
    state: 'livePreview',
    through:
      input.quizzersThrough ??
      [...QUIZZER_STAGES]
        .reverse()
        .find((stage) => individual.some((quiz) => quiz.stage === stage)) ??
      'prelim',
    lists: quizzerStandings(
      individual.map(({ name, scored }) => ({
        name,
        consolation: scored.consolation,
        teams: scored.teams,
      })),
    ),
  }

  // Two quizzer names on one team that look like one quizzer misspelt. Two names in one quiz are
  // two quizzers, however alike, and merging them would add their lines together
  const together = (a: QuizzerStanding, b: QuizzerStanding) =>
    a.lines.some((line) => b.lines.some((other) => other.quiz === line.quiz))
  for (const list of quizzers.lists) {
    const byTeam = new Map<string, QuizzerStanding[]>()
    for (const quizzer of list.quizzers) {
      const key = foldName(quizzer.team)
      byTeam.set(key, [...(byTeam.get(key) ?? []), quizzer])
    }
    for (const team of byTeam.values()) {
      team.forEach((quizzer, i) => {
        for (const other of team.slice(i + 1)) {
          const names: [string, string] = [quizzer.name, other.name]
          if (
            looksAlike(...names) &&
            !together(quizzer, other) &&
            !isDismissed(input.dismissed, quizzer.team, names)
          ) {
            warnings.push({ kind: 'lookAlikeQuizzers', division, team: quizzer.team, names })
          }
        }
      })
    }
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

/** Whether an admin said two names are different */
function isDismissed(
  dismissed: NameDismissal[] | undefined,
  team: string | null,
  names: [string, string],
): boolean {
  if (!dismissed?.length) return false
  const pair = nameDismissal(team, names)
  return dismissed.some(
    (d) => d.team === pair.team && d.names[0] === pair.names[0] && d.names[1] === pair.names[1],
  )
}

/**
 * A table as the admin confirmed it, where they did: their order stands locked in whatever later
 * corrections do, and the current order is kept beside it where it differs (FR-019b)
 */
function asConfirmed(table: TeamTable, confirmed: ConfirmedOrder | undefined): TeamTable {
  if (!confirmed) return table
  const sameOrder =
    table.teams.length === confirmed.teams.length &&
    table.teams.every((team, i) => {
      const was = confirmed.teams[i]!
      return (
        foldName(team.name) === foldName(was.name) &&
        team.rank === was.rank &&
        team.placementPoints === was.placementPoints
      )
    })
  return {
    state: 'lockedIn',
    teams: confirmed.teams,
    ...(sameOrder ? {} : { current: table.teams }),
    confirmed: { by: confirmed.by, at: confirmed.at },
  }
}

/**
 * A quiz with every team placed. Teams still level in an overtime not played out have no place;
 * such a quiz counts only once accepted as scored, and is then placed by its scores as they stand,
 * the level teams sharing the place.
 */
function placedAsTheyStand(scored: ScoredQuiz): ScoredQuiz {
  if (scored.teams.every((team) => team.place !== null)) return scored
  // A two-team quiz's empty seat has no place, and takes none from the teams that played. With no
  // overtime to play, level teams share their place
  const played = playing(scored.teams)
  const places = computePlacements(
    played.map((team) => team.score),
    [],
    true,
    false,
  )
  return {
    ...scored,
    teams: scored.teams.map((team) => {
      const at = played.indexOf(team)
      return at === -1 ? team : { ...team, place: places[at]! }
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

/**
 * A quiz that counts, as the standings take it: teams level in it are given placement points the
 * meet's way, whatever the quiz file carries (FR-023a)
 */
function counted({ name, scored }: Staged, levelTeams: PlacementFormula): CountedQuiz {
  return {
    name,
    teams: scored.teams.map((team) => ({
      name: team.name,
      score: team.score,
      place: team.place,
      placementPoints: computePlacementPoints(team.regulationScore, team.place, levelTeams),
      errors: team.errors,
    })),
  }
}

/** The quizzes behind each team's total, by the team's folded name */
function teamLines(quizzes: Staged[], levelTeams: PlacementFormula): Map<string, TeamRow['lines']> {
  const linesOf = new Map<string, TeamRow['lines']>()
  for (const { name, stage, scored } of quizzes) {
    for (const team of scored.teams) {
      const key = foldName(team.name)
      const lines = linesOf.get(key) ?? []
      lines.push({
        quiz: name,
        stage,
        place: team.place === null ? null : placeRank(team.place),
        score: team.score,
        placementPoints: computePlacementPoints(team.regulationScore, team.place, levelTeams),
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
  prelimTeams: { name: string }[],
  prelims: Staged[],
  intermediates: Staged[],
  levelTeams: PlacementFormula,
  tieBreaks: TieBreakOrder,
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
    const lines = teamLines(together, levelTeams)
    // Ranked among the line's teams alone: their points from every quiz, and ties broken between
    // them, never against a team outside the line
    const order = divisionStandings(
      together
        .map((quiz) => counted(quiz, levelTeams))
        .map((quiz) => ({
          ...quiz,
          teams: quiz.teams.filter((team) => inLine.has(foldName(team.name))),
        })),
      { finalists: false, tieBreaks },
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

/** Whether some quizzer of a quiz has correct answers no question type accounts for */
function typesIncomplete(scored: ScoredQuiz): boolean {
  return scored.teams.some((team) =>
    team.quizzers.some(
      (quizzer) => Object.values(quizzer.types).reduce((sum, n) => sum + n, 0) !== quizzer.correct,
    ),
  )
}

function quizResult(quiz: Staged, levelTeams: PlacementFormula): QuizResult {
  const named = quiz.scored.teams.filter((team) => tidyName(team.name) !== '')
  const flags = {
    ...(quiz.withdrawnOrder ? { withdrawnOrder: true as const } : {}),
    ...(typesIncomplete(quiz.scored) ? { incompleteTypes: true as const } : {}),
  }
  if (!quiz.counts) {
    return {
      name: quiz.name,
      status: 'underReview',
      teams: named.map((team) => ({ name: tidyName(team.name) })),
      id: quiz.id,
      problems: quiz.problems,
      ...flags,
    }
  }
  return {
    name: quiz.name,
    status: quiz.problems.length > 0 ? 'accepted' : 'counted',
    teams: named.map((team) => {
      const place = team.place === null ? undefined : placeRank(team.place)
      const tiedWith = team.place === null ? 1 : placeTieCount(team.place)
      const placementPoints = computePlacementPoints(team.regulationScore, team.place, levelTeams)
      return {
        name: tidyName(team.name),
        ...(place ? { place } : {}),
        ...(tiedWith > 1 ? { tiedWith } : {}),
        score: team.score,
        ...(placementPoints === null ? {} : { placementPoints }),
        errors: team.errors,
      }
    }),
    id: quiz.id,
    ...(quiz.problems.length > 0 ? { problems: quiz.problems } : {}),
    ...flags,
  }
}
