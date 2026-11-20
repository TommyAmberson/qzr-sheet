import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { DIVISION_STATES, type DivisionStateValue, type MeetPhase } from '../phases'
import { PlacementFormula } from '../quizFile'
import { TIE_BREAK_ORDERS } from '../scoring/standings'
import { STAGES, type Stage } from './stages'

/**
 * The moments a thing can start to show to viewers from. A division's moments are reached by its
 * state, the meet's by its phase; each stays reached while they stay there or move beyond.
 */
export const MOMENTS = [
  'start',
  'prelimsConfirmed',
  'intermediatesConfirmed',
  'eliminationsIn',
  'finalsDone',
  'meetReview',
  'meetDone',
] as const
export type Moment = (typeof MOMENTS)[number]

/** The stages a quizzer's figures come from: every one but the Finals */
export const QUIZZER_STAGES = ['prelim', 'intermediate', 'elimination'] as const
export type QuizzerStage = (typeof QUIZZER_STAGES)[number]

/** The first moment a stage's quizzes can be played by, so the earliest its results can show */
export const STAGE_BEGINS: Record<Stage, Moment> = {
  prelim: 'start',
  intermediate: 'prelimsConfirmed',
  elimination: 'intermediatesConfirmed',
  finals: 'eliminationsIn',
}

const ShownFromSchema = Type.Union([
  ...MOMENTS.map((moment) => Type.Literal(moment)),
  Type.Literal('never'),
])
export type ShownFrom = Static<typeof ShownFromSchema>

const LevelSchema = Type.Union([Type.Literal('places'), Type.Literal('scores')])
/** How much of a quiz a viewer is shown; the full scoresheet stays with admins and its officials */
export type ResultsLevel = Static<typeof LevelSchema>

/** Settings are stored as sent, so a document with anything but these is refused */
const closed = { additionalProperties: false }

const StageResultsSchema = Type.Object({ from: ShownFromSchema, level: LevelSchema }, closed)

const StatsSettingsSchema = Type.Object(
  {
    tieBreaks: Type.Union(TIE_BREAK_ORDERS.map((order) => Type.Literal(order))),
    /** How teams level in a quiz are given placement points, whatever each quiz file says */
    levelTeams: Type.Enum(PlacementFormula),
    /** Prelims and intermediates are played with no overtime, a tie standing */
    prelimsWithoutOvertime: Type.Boolean(),
    results: Type.Object(
      {
        prelim: StageResultsSchema,
        intermediate: StageResultsSchema,
        elimination: StageResultsSchema,
        finals: StageResultsSchema,
      },
      closed,
    ),
    /** Whether prelim standings and the re-rank also show as a live preview before confirmed */
    prelimStandingsLive: Type.Boolean(),
    /**
     * Whether admins, and officials on their own quizzes, are warned of question types that don't
     * add up (FR-007); false for a meet that doesn't record them. Absent, as in settings saved
     * before it, means warned
     */
    warnIncompleteTypes: Type.Optional(Type.Boolean()),
    quizzers: Type.Object(
      {
        from: ShownFromSchema,
        update: Type.Union([Type.Literal('live'), Type.Literal('byStage')]),
      },
      closed,
    ),
  },
  closed,
)
export type StatsSettings = Static<typeof StatsSettingsSchema>

/** A meet's stats settings until an admin changes them (FR-018b, FR-023, FR-023a, FR-023d) */
export const DEFAULT_STATS_SETTINGS: StatsSettings = {
  tieBreaks: 'rulebook',
  levelTeams: PlacementFormula.Rules,
  prelimsWithoutOvertime: true,
  results: {
    prelim: { from: STAGE_BEGINS.prelim, level: 'places' },
    intermediate: { from: STAGE_BEGINS.intermediate, level: 'places' },
    elimination: { from: STAGE_BEGINS.elimination, level: 'places' },
    finals: { from: 'finalsDone', level: 'places' },
  },
  prelimStandingsLive: false,
  quizzers: { from: 'meetDone', update: 'live' },
}

/** Whether a meet warns of question types that don't add up; absent, the choice means yes */
export function warnsIncompleteTypes(
  settings: Pick<StatsSettings, 'warnIncompleteTypes'>,
): boolean {
  return settings.warnIncompleteTypes !== false
}

/** Why a settings document can't be saved, or null when it can */
export function statsSettingsError(settings: unknown): string | null {
  if (!Value.Check(StatsSettingsSchema, settings)) {
    const [first] = Value.Errors(StatsSettingsSchema, settings)
    return `Invalid stats settings: ${first?.path || '/'} ${first?.message ?? ''}`.trim()
  }
  for (const stage of STAGES) {
    const { from } = settings.results[stage]
    if (from !== 'never' && MOMENTS.indexOf(from) < MOMENTS.indexOf(STAGE_BEGINS[stage])) {
      return `The ${stage} results can't show before the ${stage} quizzes are played`
    }
  }
  return null
}

/** Whether anyone but an admin sees a meet's stats in this phase: none before it is live (FR-019) */
export function viewersSeeStats(phase: MeetPhase): boolean {
  return phase === 'live' || phase === 'review' || phase === 'done'
}

const stateAt = (state: DivisionStateValue) => DIVISION_STATES.indexOf(state)

/** Whether a division in this state, in a meet in this phase, has reached a moment */
function momentReached(moment: ShownFrom, state: DivisionStateValue, phase: MeetPhase): boolean {
  switch (moment) {
    case 'never':
      return false
    case 'start':
      return true
    case 'prelimsConfirmed':
      return stateAt(state) >= stateAt('stats_break')
    case 'intermediatesConfirmed':
      return stateAt(state) >= stateAt('elim_running')
    case 'eliminationsIn':
      return stateAt(state) >= stateAt('finals')
    case 'finalsDone':
      return state === 'division_done'
    case 'meetReview':
      return phase === 'review' || phase === 'done'
    case 'meetDone':
      return phase === 'done'
  }
}

/**
 * Which of three states standings are in (FR-020): a live preview still changes as quizzes come
 * in; a preview changes only by a correction; locked in will not change.
 */
export type StandingsState = 'livePreview' | 'preview' | 'lockedIn'

/** What a viewer of a division has of each thing; null where they have nothing of it yet */
export interface ViewerHas {
  /** How much of each stage's quizzes; a stage left out shows nothing */
  results: Partial<Record<Stage, ResultsLevel>>
  /** The current figures as a live preview, or the order the admin confirmed */
  prelimStandings: Exclude<StandingsState, 'preview'> | null
  rerank: Exclude<StandingsState, 'preview'> | null
  /** Quizzer standings, over the quizzes of the stages up to and including `through` */
  quizzers: { state: StandingsState; through: QuizzerStage } | null
}

const NOTHING: ViewerHas = { results: {}, prelimStandings: null, rerank: null, quizzers: null }

/**
 * What a viewer or coach is given of a division's stats (FR-018 to FR-020), from the meet's
 * settings, the division's state and the meet's phase; officials and admins see everything
 * (FR-019). The API cuts every response to it, and the settings page shows it, so the two can't
 * disagree.
 */
export function viewerHas(
  settings: StatsSettings,
  state: DivisionStateValue,
  phase: MeetPhase,
): ViewerHas {
  if (!viewersSeeStats(phase)) return NOTHING
  const reached = (moment: ShownFrom) => momentReached(moment, state, phase)

  const results: ViewerHas['results'] = {}
  for (const stage of STAGES) {
    const { from, level } = settings.results[stage]
    if (reached(from)) results[stage] = level
  }

  // Confirming an order puts it in the elimination draw, so it shows from then on, locked in
  const confirmedOrPreview = (confirmedFrom: Moment, previewFrom: Moment) =>
    reached(confirmedFrom)
      ? 'lockedIn'
      : settings.prelimStandingsLive && reached(previewFrom)
        ? 'livePreview'
        : null

  return {
    results,
    prelimStandings: confirmedOrPreview('prelimsConfirmed', 'start'),
    rerank: confirmedOrPreview('intermediatesConfirmed', 'prelimsConfirmed'),
    quizzers: reached(settings.quizzers.from) ? quizzersHad(settings, state, phase) : null,
  }
}

function quizzersHad(
  settings: StatsSettings,
  state: DivisionStateValue,
  phase: MeetPhase,
): ViewerHas['quizzers'] {
  if (phase === 'done') return { state: 'lockedIn', through: 'elimination' }
  // From the eliminations in, no quiz counts for quizzers any more
  if (momentReached('eliminationsIn', state, phase)) {
    return { state: 'preview', through: 'elimination' }
  }
  if (settings.quizzers.update === 'live') return { state: 'livePreview', through: 'elimination' }
  // By stage: the quizzes up to the last step the admin confirmed, and none before the first
  if (momentReached('intermediatesConfirmed', state, phase)) {
    return { state: 'preview', through: 'intermediate' }
  }
  if (momentReached('prelimsConfirmed', state, phase))
    return { state: 'preview', through: 'prelim' }
  return null
}
