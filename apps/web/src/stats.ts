import {
  DIVISION_STATES,
  MOMENTS,
  STAGES,
  STAGE_BEGINS,
  divisionTitle,
  validationMessage,
  viewerHas,
  type DivisionStateValue,
  type DivisionStats,
  type MeetPhase,
  type QuizProblem,
  type QuizzerFlag,
  type ShownFrom,
  type Stage,
  type StageChoice,
  type StandingsState,
  type StatsSettings,
  type AttentionItem,
  type TieBreak,
  type ViewerHas,
  warnsIncompleteTypes,
} from '@qzr/shared'
import type { HistoryEntry } from './api'

/** What a stage is called */
export const STAGE_LABELS: Record<StageChoice, string> = {
  prelim: 'Prelim',
  intermediate: 'Intermediate',
  elimination: 'Elimination',
  finals: 'Finals',
  notCounted: 'Not counted',
}

/** A decision in a stored quiz's history, as a few words */
export function changeText(
  change: Omit<Extract<HistoryEntry, { kind: 'change' }>, 'kind' | 'changedBy' | 'changedAt'>,
): string {
  switch (change.what) {
    case 'stage':
      return change.stage
        ? `Stage set to ${STAGE_LABELS[change.stage]}`
        : 'Stage left to the schedule'
    case 'link':
      if (!change.scheduleQuizId) return 'Unlinked from the schedule'
      return change.how === 'sheet'
        ? 'Linked to the schedule by the scoresheet'
        : change.how === 'matched'
          ? 'Linked to the schedule by its name and teams'
          : 'Linked to the schedule by hand'
    case 'acceptance':
      return `Revision ${change.revision} ${change.accepted ? 'accepted as scored' : 'no longer accepted'}`
    case 'kept':
      return 'Kept as it is'
  }
}

/** How a standings table names the tie-breaker that separated a team from those level with it */
export const TIE_BREAKS: Record<TieBreak, string> = {
  headToHead: 'head-to-head',
  points: 'total points',
  errors: 'fewest errors',
}

const ORDINALS = ['', '1st', '2nd', '3rd']

/** A team's place in a quiz: "2nd", or "tied 1st" when teams share it */
export function placeLabel(place: number, tiedWith = 1): string {
  const label = ORDINALS[place] ?? String(place)
  return tiedWith > 1 ? `tied ${label}` : label
}

/** One thing wrong with a stored quiz, as a line an admin can act on */
export function problemText(problem: QuizProblem): string {
  switch (problem.kind) {
    case 'validation': {
      const seat = [problem.team, problem.quizzer].filter((part) => part).join(', ')
      const where = [seat, problem.question && `question ${problem.question}`]
        .filter((part) => part)
        .join(', ')
      return `${where}: ${validationMessage(problem.code)}`
    }
    case 'unanswered': {
      const many = problem.questions.length > 1
      return `Question${many ? 's' : ''} ${problem.questions.join(', ')} ${many ? 'have' : 'has'} no answer.`
    }
    case 'undecided':
      return 'Teams are still level: the overtime is not finished.'
    case 'teamNotOnRoster': {
      const team = problem.team ? `${problem.team} is` : 'A team with no name is'
      return `${team} not one of the division's teams.${problem.near ? ` The roster has ${problem.near}.` : ''}`
    }
    case 'quizzerNotOnRoster':
      return `${problem.team}: ${problem.quizzer} is not on the roster.${problem.near ? ` The roster has ${problem.near}.` : ''}`
    case 'quizzerMissing':
      return `${problem.team}: ${problem.quizzer} is on the roster and not in this quiz.`
    case 'divisionNotOnRoster':
      return "Its division has no teams on the meet's roster."
    case 'tooManyQuizzers':
      return `${problem.team} lists ${problem.listed} quizzers; its roster has ${problem.roster}.`
    case 'notLinked':
      return 'It is not linked to a quiz of the schedule.'
    case 'nameDiffers':
      return `It is linked to ${problem.scheduled}, which is not its name.`
    case 'teamsDiffer':
      return `Its teams are not the schedule's: ${problem.scheduled.join(', ')}.`
    case 'tieLeftStanding':
      return 'It ended level with no overtime, and this quiz must have a winner.'
    case 'overtimePlayed':
      return 'It went to overtime, which this meet does not play in prelims and intermediates.'
  }
}

/** A flag on a quizzer's line in the standings, for the admin */
export function flagText(flag: QuizzerFlag): string {
  switch (flag.kind) {
    case 'quizCount':
      return `listed in ${flag.listed} of the team's ${flag.teamQuizzes} quizzes`
    case 'incompleteTypes':
      return 'question types incomplete'
  }
}

/** A warning on a division's stats, or anything else that needs attention, as a sentence */
export function warningText(warning: AttentionItem): string {
  switch (warning.kind) {
    case 'inError': {
      const count = warning.problems.length
      return `${warning.quiz.name} has ${count === 1 ? 'an error' : `${count} errors`}, so it doesn't count toward the standings until fixed or accepted as scored.`
    }
    case 'unequalPrelims':
      return `Teams have played different numbers of counted quizzes: ${warning.teams
        .map((team) => `${team.name} ${team.quizzes}`)
        .join(', ')}.`
    case 'lookAlikeTeams':
      return `${warning.names[0]} and ${warning.names[1]} look like one team spelt two ways.`
    case 'twoFinals':
      return `${warning.quizzes.map((quiz) => quiz.name).join(' and ')} are both the ${warning.consolation ? 'consolation ' : ''}Finals, so neither gives its first three. Set all but one to another stage.`
    case 'finalTie':
      return `${warning.teams.join(', ')} are tied for the last places in the final. Settle it away from the app.`
    case 'orderChanged':
      return `The ${warning.what === 'prelims' ? 'prelim order' : 're-rank'} has changed since it was confirmed. The confirmed order stands; the current one is shown beside it.`
    case 'withdrawnOrder':
      return `${warning.quiz.name} was seated from an order since withdrawn. Keep it as it is, or set it to not counted.`
    case 'lookAlikeQuizzers':
      return `${warning.names[0]} and ${warning.names[1]} on ${warning.team} look like one quizzer spelt two ways.`
    case 'noStage':
      return `${warning.quiz.name} has no stage, so it counts for nothing. Link it to the schedule or set its stage.`
    case 'quizzerCount':
      return `${warning.quizzer} of ${warning.team} is listed in ${warning.listed} of the team's ${warning.teamQuizzes} quizzes${warning.missing.length ? `, not in ${warning.missing.map((quiz) => quiz.name).join(', ')}` : ''}.`
    case 'incompleteTypes':
      return `${warning.quiz.name} doesn't give a question type for every correct answer.`
    case 'otherFormula': {
      const n = warning.quizzes.length
      return `${n === 1 ? '1 quiz scores' : `${n} quizzes score`} teams level on points another way than the meet.`
    }
  }
}

/** The three states standings are in (FR-020), in the same words wherever they are shown */
export const STANDINGS_STATES: Record<StandingsState, { label: string; meaning: string }> = {
  livePreview: {
    label: 'Live preview',
    meaning: 'not the actual standings yet: still changing as quizzes come in',
  },
  preview: {
    label: 'Preview',
    meaning: 'not the actual standings yet: not changing now, but may still be corrected',
  },
  lockedIn: { label: 'Locked in', meaning: 'the actual standings: will not change' },
}

/** When a thing starts to show, as the end of "show …" */
export const MOMENT_WORDS: Record<ShownFrom, string> = {
  start: 'from the start of quizzing',
  prelimsConfirmed: 'once the prelims are confirmed',
  intermediatesConfirmed: 'once the intermediates are confirmed',
  eliminationsIn: 'once the eliminations are in',
  finalsDone: 'once the Finals is done',
  meetReview: 'once the meet is in review',
  meetDone: 'once the meet is done',
  never: 'never',
}

/** The moments a stage's results can be set to show from: none before the stage is played */
export function momentsFor(stage: Stage): ShownFrom[] {
  return [...MOMENTS.slice(MOMENTS.indexOf(STAGE_BEGINS[stage])), 'never']
}

/** What viewers are shown, thing by thing, by the names the settings page uses */
export type ViewerThing = Stage | 'prelimStandings' | 'rerank' | 'quizzers'

export const THING_NAMES: Record<ViewerThing, string> = {
  prelim: 'prelim results',
  intermediate: 'intermediate results',
  elimination: 'elimination results',
  finals: 'the Finals result',
  prelimStandings: 'prelim standings',
  rerank: 'the re-rank',
  quizzers: 'quizzer standings',
}

const THINGS: ViewerThing[] = [...STAGES, 'prelimStandings', 'rerank', 'quizzers']

/** How much of a thing a viewer has, in a word or two; null for nothing */
function hasOf(has: ViewerHas, thing: ViewerThing): string | null {
  if (thing === 'prelimStandings' || thing === 'rerank') {
    const state = has[thing]
    return state && STANDINGS_STATES[state].label
  }
  if (thing === 'quizzers') return has.quizzers && STANDINGS_STATES[has.quizzers.state].label
  const level = has.results[thing]
  return level ? (level === 'scores' ? 'places and scores' : 'places') : null
}

/** What a division's viewers have of a thing right now, as the settings page shows it */
export function rightNow(has: ViewerHas, thing: ViewerThing): string {
  return hasOf(has, thing) ?? 'none'
}

/** A division as the settings page holds it: its name and its state */
export interface DivisionAt {
  division: string
  state: DivisionStateValue
}

/**
 * What saving the settings changes for viewers the moment it is saved (FR-023c): what each
 * division's viewers will newly see, stop seeing, or see more or less of, and how the standings
 * will be worked out where that changes
 */
export function viewerChanges(
  saved: StatsSettings,
  draft: StatsSettings,
  divisions: DivisionAt[],
  phase: MeetPhase,
): string[] {
  const lines: string[] = []
  for (const { division, state } of divisions) {
    const [before, after] = [viewerHas(saved, state, phase), viewerHas(draft, state, phase)]
    const who = `${divisionTitle(division)} viewers`
    for (const thing of THINGS) {
      const [was, will] = [hasOf(before, thing), hasOf(after, thing)]
      if (was === will) continue
      const name = THING_NAMES[thing]
      if (was === null) lines.push(`${who} will now see ${name}`)
      else if (will === null) lines.push(`${who} will stop seeing ${name}`)
      else if (will === 'places and scores') lines.push(`${who} will now see scores in ${name}`)
      else if (was === 'places and scores') lines.push(`${who} will stop seeing scores in ${name}`)
      else lines.push(`${who} will see ${name} as ${will.toLowerCase()}`)
    }
  }
  if (saved.quizzers.update !== draft.quizzers.update) {
    lines.push(
      `Quizzer standings will update ${draft.quizzers.update === 'live' ? 'after every quiz' : 'only when you confirm a step'}`,
    )
  }
  if (
    saved.tieBreaks !== draft.tieBreaks ||
    saved.levelTeams !== draft.levelTeams ||
    saved.prelimsWithoutOvertime !== draft.prelimsWithoutOvertime
  ) {
    lines.push(
      'Standings will be worked out the new way. Orders you already confirmed stay as they are; a difference will be shown.',
    )
  }
  return lines
}

/** A division's steps through the day, one for each of its states */
export function stepNames(stages: Stage[]): Record<DivisionStateValue, string> {
  return {
    prelim_running: 'Prelims',
    stats_break: stages.includes('intermediate') ? 'Intermediates' : 'Stats break',
    elim_running: 'Eliminations',
    finals: 'Finals',
    division_done: 'Finished',
  }
}

/**
 * The control that confirms a division's next step: the states it moves through and its label.
 * A division with no eliminations goes from its stats break to its Finals in one action, two moves
 * behind it. Null once the division is finished.
 */
export function nextMove(
  state: DivisionStateValue,
  stages: Stage[],
): { to: DivisionStateValue[]; label: string } | null {
  switch (state) {
    case 'prelim_running':
      return { to: ['stats_break'], label: 'Confirm prelims' }
    case 'stats_break':
      // Only a schedule can say a division has no eliminations; with none, it is not known
      if (stages.length > 0 && !stages.includes('elimination')) {
        return { to: ['elim_running', 'finals'], label: 'Start Finals' }
      }
      return {
        to: ['elim_running'],
        label: stages.includes('intermediate') ? 'Confirm intermediates' : 'Start eliminations',
      }
    case 'elim_running':
      return { to: ['finals'], label: 'Confirm eliminations' }
    case 'finals':
      return { to: ['division_done'], label: 'Confirm Finals' }
    case 'division_done':
      return null
  }
}

/** The state a division goes back to; null where it can't go back */
export function previousState(state: DivisionStateValue): DivisionStateValue | null {
  return DIVISION_STATES[DIVISION_STATES.indexOf(state) - 1] ?? null
}

/**
 * How many quizzers a list ranks, as the statistician's report says it: every quizzer, those with
 * no jumps included, though the printed list leaves them off (FR-026)
 */
export function quizzerCount(
  division: string,
  list: { consolation: boolean; quizzers: unknown[] },
) {
  const n = list.quizzers.length
  const where = list.consolation
    ? `the ${divisionTitle(division)} consolation list`
    : divisionTitle(division)
  return `There ${n === 1 ? 'was 1 quizzer' : `were ${n} quizzers`} in ${where}`
}

type Cell = string | number | null | undefined

/**
 * A cell as CSV writes it, quoted where it holds a comma, a quote or a line break. Text a
 * spreadsheet would read as a formula is written as plain text, since names are typed by anyone.
 */
function csvCell(value: Cell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csv(rows: Cell[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** The question types in the workbook's column order */
const TYPE_COLUMNS = ['REF', 'FTV', 'INT', 'MA', 'Q', 'SIT'] as const

/**
 * A division's stats as the three files the statistician's workbook holds (FR-028, R13), from the
 * admin's stats: a row per team per quiz, a row per quizzer per quiz, and the standings
 */
export function statsCsv(stats: DivisionStats): {
  teams: string
  quizzers: string
  standings: string
} {
  // The quizzes in the order they were played; quizzes under review carry no figures
  const played = [...stats.results]
    .reverse()
    .flatMap((stage) => stage.quizzes.filter((quiz) => quiz.status !== 'underReview'))
  const teams = csv([
    ['Team', 'Quiz', 'Place', 'Score', 'Points', 'Errors'],
    ...played.flatMap((quiz) =>
      quiz.teams.map((team) => [
        team.name,
        quiz.name,
        team.place,
        team.score,
        team.placementPoints,
        team.errors,
      ]),
    ),
  ])
  const lists = stats.quizzers?.lists ?? []
  const quizzers = csv([
    ['Quizzer', 'Team', 'Quiz', 'Points', 'Errors', 'Jumps', ...TYPE_COLUMNS],
    ...lists.flatMap((list) =>
      list.quizzers.flatMap((quizzer) =>
        quizzer.lines.map((line) => [
          quizzer.name,
          quizzer.team,
          line.quiz,
          line.points,
          line.errors,
          line.jumps,
          ...TYPE_COLUMNS.map((type) => line.types[type] ?? 0),
        ]),
      ),
    ),
  ])
  const tables = [
    ['Prelims', stats.prelimStandings],
    ['After the intermediates', stats.rerank],
  ] as const
  const standings = csv([
    ['Table', 'Rank', 'Tied', 'Team', 'Points', 'Quizzes'],
    ...tables.flatMap(([table, shown]) =>
      (shown?.teams ?? []).map((team) => [
        table,
        team.rank,
        team.tied ? 'yes' : '',
        team.name,
        team.placementPoints,
        team.quizzes,
      ]),
    ),
    [],
    ['List', 'Place', 'Quizzer', 'Team', 'Average', 'Points', 'Errors', 'Jumps', 'Quizzes'],
    ...lists.flatMap((list) =>
      list.quizzers.map((quizzer) => [
        list.consolation ? 'Consolation' : 'Main',
        quizzer.place,
        quizzer.name,
        quizzer.team,
        Number(quizzer.average.toFixed(2)),
        quizzer.points,
        quizzer.errors,
        quizzer.jumps,
        quizzer.quizzes,
      ]),
    ),
  ])
  return { teams, quizzers, standings }
}

/**
 * Settings as text two equal settings share, whatever the order of their top-level keys (the
 * question types choice is added or dropped there), the choice counting by what it means (absent
 * and on both warn); `withoutTypes` leaves the choice out
 */
export function settingsKey(settings: StatsSettings, withoutTypes = false): string {
  const all: Record<string, unknown> = { ...withTypesChoice(settings, true) }
  if (!withoutTypes) all.warnIncompleteTypes = warnsIncompleteTypes(settings)
  const sorted = Object.keys(all)
    .sort()
    .map((key) => [key, all[key]])
  return JSON.stringify(Object.fromEntries(sorted))
}

/**
 * Settings with the question types choice made. Off is written; on leaves the choice out, as its
 * absence means, so an API from before the choice still takes the save
 */
export function withTypesChoice(settings: StatsSettings, warn: boolean): StatsSettings {
  const { warnIncompleteTypes: _choice, ...rest } = settings
  return warn ? rest : { ...rest, warnIncompleteTypes: false }
}
