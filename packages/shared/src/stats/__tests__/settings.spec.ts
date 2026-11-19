import { describe, expect, it } from 'vitest'
import { DIVISION_STATES, MEET_PHASES, type DivisionStateValue, type MeetPhase } from '../../phases'
import { PlacementFormula } from '../../quizFile'
import {
  DEFAULT_STATS_SETTINGS,
  MOMENTS,
  statsSettingsError,
  viewerHas,
  type ShownFrom,
  type StatsSettings,
} from '../settings'

const settings = (change: (s: StatsSettings) => void = () => {}): StatsSettings => {
  const s = structuredClone(DEFAULT_STATS_SETTINGS)
  change(s)
  return s
}

const RUNNING: MeetPhase[] = ['live', 'review', 'done']

describe('stats settings', () => {
  it('start as the rulebook and FR-018b have them', () => {
    expect(DEFAULT_STATS_SETTINGS).toMatchObject({
      tieBreaks: 'rulebook',
      levelTeams: PlacementFormula.Rules,
      // These meets have long played their prelims without overtime (FR-023d)
      prelimsWithoutOvertime: true,
      results: {
        prelim: { from: 'start', level: 'places' },
        intermediate: { from: 'prelimsConfirmed', level: 'places' },
        elimination: { from: 'intermediatesConfirmed', level: 'places' },
        finals: { from: 'finalsDone', level: 'places' },
      },
      prelimStandingsLive: false,
      quizzers: { from: 'meetDone' },
    })
    expect(statsSettingsError(DEFAULT_STATS_SETTINGS)).toBeNull()
  })

  it("refuse a stage's results set to show before the stage is played", () => {
    expect(
      statsSettingsError(settings((s) => (s.results.elimination.from = 'prelimsConfirmed'))),
    ).toMatch(/elimination/)
    expect(statsSettingsError(settings((s) => (s.results.finals.from = 'start')))).toMatch(/finals/)
    expect(statsSettingsError(settings((s) => (s.results.finals.from = 'never')))).toBeNull()
    expect(statsSettingsError(settings((s) => (s.results.prelim.from = 'meetDone')))).toBeNull()
  })

  it('refuse a document that is not one', () => {
    expect(statsSettingsError({ ...DEFAULT_STATS_SETTINGS, tieBreaks: 'coinToss' })).toMatch(
      /tieBreaks/,
    )
    expect(statsSettingsError(null)).not.toBeNull()
    // Stored as sent, so nothing else may ride along
    expect(statsSettingsError({ ...DEFAULT_STATS_SETTINGS, junk: 1 })).not.toBeNull()
    expect(
      statsSettingsError({
        ...DEFAULT_STATS_SETTINGS,
        quizzers: { ...DEFAULT_STATS_SETTINGS.quizzers, junk: 1 },
      }),
    ).not.toBeNull()
  })
})

describe('the moments', () => {
  // Prelim results may show from any moment, so they show whether one is reached
  const reached = (moment: ShownFrom, state: DivisionStateValue, phase: MeetPhase) =>
    viewerHas(
      settings((s) => (s.results.prelim.from = moment)),
      state,
      phase,
    ).results.prelim !== undefined

  it('are reached by the division state or the meet phase, and stay reached beyond', () => {
    const firstState: Partial<Record<(typeof MOMENTS)[number], DivisionStateValue>> = {
      start: 'prelim_running',
      prelimsConfirmed: 'stats_break',
      intermediatesConfirmed: 'elim_running',
      eliminationsIn: 'finals',
      finalsDone: 'division_done',
    }
    for (const [moment, first] of Object.entries(firstState)) {
      for (const state of DIVISION_STATES) {
        expect(reached(moment as keyof typeof firstState, state, 'live')).toBe(
          DIVISION_STATES.indexOf(state) >= DIVISION_STATES.indexOf(first),
        )
      }
    }
    for (const phase of RUNNING) {
      expect(reached('meetReview', 'prelim_running', phase)).toBe(phase !== 'live')
      expect(reached('meetDone', 'division_done', phase)).toBe(phase === 'done')
    }
    expect(reached('never', 'division_done', 'done')).toBe(false)
  })
})

describe('what a viewer has', () => {
  it('is nothing outside live, review and done, whatever is set', () => {
    const everything = settings((s) => {
      s.results.prelim.from = 'start'
      s.prelimStandingsLive = true
      s.quizzers.from = 'start'
    })
    for (const phase of MEET_PHASES.filter((phase) => !RUNNING.includes(phase))) {
      for (const state of DIVISION_STATES) {
        expect(viewerHas(everything, state, phase)).toEqual({
          results: {},
          prelimStandings: null,
          rerank: null,
          quizzers: null,
        })
      }
    }
  })

  it("gives each stage's results from its moment, at the level set", () => {
    const scores = settings((s) => (s.results.elimination.level = 'scores'))
    expect(
      DIVISION_STATES.map((state) => Object.keys(viewerHas(scores, state, 'live').results)),
    ).toEqual([
      ['prelim'],
      ['prelim', 'intermediate'],
      ['prelim', 'intermediate', 'elimination'],
      ['prelim', 'intermediate', 'elimination'],
      ['prelim', 'intermediate', 'elimination', 'finals'],
    ])
    expect(viewerHas(scores, 'elim_running', 'live').results).toEqual({
      prelim: 'places',
      intermediate: 'places',
      elimination: 'scores',
    })
    expect(
      viewerHas(
        settings((s) => (s.results.prelim.from = 'never')),
        'division_done',
        'done',
      ),
    ).toMatchObject({ results: { finals: 'places' } })
  })

  it('shows prelim standings and the re-rank locked in once confirmed', () => {
    const byState = (s: StatsSettings) =>
      DIVISION_STATES.map((state) => {
        const has = viewerHas(s, state, 'live')
        return [state, has.prelimStandings, has.rerank]
      })
    expect(byState(DEFAULT_STATS_SETTINGS)).toEqual([
      ['prelim_running', null, null],
      ['stats_break', 'lockedIn', null],
      ['elim_running', 'lockedIn', 'lockedIn'],
      ['finals', 'lockedIn', 'lockedIn'],
      ['division_done', 'lockedIn', 'lockedIn'],
    ])
    // Shown live as well, each is a live preview until confirmed
    expect(byState(settings((s) => (s.prelimStandingsLive = true)))).toEqual([
      ['prelim_running', 'livePreview', null],
      ['stats_break', 'lockedIn', 'livePreview'],
      ['elim_running', 'lockedIn', 'lockedIn'],
      ['finals', 'lockedIn', 'lockedIn'],
      ['division_done', 'lockedIn', 'lockedIn'],
    ])
  })

  it('gives quizzer standings from their moment, locked in only once the meet is done', () => {
    const live = settings((s) => (s.quizzers = { from: 'start', update: 'live' }))
    const byStage = settings((s) => (s.quizzers = { from: 'start', update: 'byStage' }))
    const byState = (s: StatsSettings, phase: MeetPhase) =>
      DIVISION_STATES.map((state) => [state, viewerHas(s, state, phase).quizzers])
    expect(byState(live, 'live')).toEqual([
      ['prelim_running', { state: 'livePreview', through: 'elimination' }],
      ['stats_break', { state: 'livePreview', through: 'elimination' }],
      ['elim_running', { state: 'livePreview', through: 'elimination' }],
      // Nothing more counts for quizzers once the eliminations are in
      ['finals', { state: 'preview', through: 'elimination' }],
      ['division_done', { state: 'preview', through: 'elimination' }],
    ])
    // By stage: the quizzes up to the last step the admin confirmed
    expect(byState(byStage, 'review')).toEqual([
      ['prelim_running', null],
      ['stats_break', { state: 'preview', through: 'prelim' }],
      ['elim_running', { state: 'preview', through: 'intermediate' }],
      ['finals', { state: 'preview', through: 'elimination' }],
      ['division_done', { state: 'preview', through: 'elimination' }],
    ])
    for (const s of [live, byStage]) {
      expect(viewerHas(s, 'division_done', 'done').quizzers).toEqual({
        state: 'lockedIn',
        through: 'elimination',
      })
    }
    // By default they show once the meet is done, and not before
    expect(viewerHas(DEFAULT_STATS_SETTINGS, 'division_done', 'review').quizzers).toBeNull()
    expect(viewerHas(DEFAULT_STATS_SETTINGS, 'division_done', 'done').quizzers?.state).toBe(
      'lockedIn',
    )
    expect(
      viewerHas(
        settings((s) => (s.quizzers.from = 'never')),
        'division_done',
        'done',
      ),
    ).toMatchObject({ quizzers: null })
  })
})
