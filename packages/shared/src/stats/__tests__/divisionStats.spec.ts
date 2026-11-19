import { describe, it, expect } from 'vitest'
import { PlacementFormula, type QuizFile } from '../../quizFile'
import { deserialize } from '../../quizFileCodec'
import { foldName } from '../../results'
import { quizOutcome } from '../../scoring/quizOutcome'
import { divisionStandings } from '../../scoring/standings'
import { fifteenQuestionQuizFile } from '../../scoring/__tests__/fixtures/fifteenQuestionQuiz'
import { referenceMeet } from '../../scoring/__tests__/fixtures/referenceMeet'
import {
  attentionOf,
  divisionStats,
  nameDismissal,
  type DivisionStatsInput,
  type StatsQuiz,
} from '../divisionStats'
import { DEFAULT_STATS_SETTINGS } from '../settings'
import type { Stage } from '../stages'
import { scoreStoredQuiz, type ScoredQuiz } from '../scoredQuiz'

let nextId = 1
function stored(name: string, stage: Stage | null, file: QuizFile): StatsQuiz {
  return quizOf(name, stage, scoreStoredQuiz(file))
}
function quizOf(name: string, stage: Stage | null, scored: ScoredQuiz): StatsQuiz {
  return { id: nextId++, name, key: name, stage, scored, linked: null, accepted: false }
}
function stats(
  quizzes: StatsQuiz[],
  more: Partial<Omit<DivisionStatsInput, 'division' | 'state' | 'phase' | 'quizzes'>> = {},
) {
  return divisionStats({
    division: '1',
    state: 'prelim_running',
    phase: 'live',
    quizzes,
    roster: null,
    laterStagesScheduled: false,
    schedulePublished: false,
    settings: DEFAULT_STATS_SETTINGS,
    ...more,
  })
}

/** A quiz three teams finished in the order given, 100, 60 and 20 points */
function scoredQuiz(first: string, second: string, third: string): ScoredQuiz {
  return {
    name: 'D1 Q1',
    consolation: false,
    teams: [first, second, third].map((name, i) => ({
      name,
      score: 100 - i * 40,
      regulationScore: 100 - i * 40,
      errors: i,
      place: (i + 1) as 1 | 2 | 3,
      quizzers: [],
    })),
    overtimePlayed: false,
    problems: [],
  }
}

describe('divisionStats', () => {
  it('groups quizzes by stage, newest stage first, with places and scores', () => {
    const { results } = stats([
      stored('D1 Q1', 'prelim', fifteenQuestionQuizFile()),
      stored('D1 QA', 'elimination', fifteenQuestionQuizFile()),
      stored('D1 Q2', 'prelim', fifteenQuestionQuizFile()),
    ])
    expect(results.map((r) => [r.stage, r.quizzes.map((q) => q.name)])).toEqual([
      ['elimination', ['D1 QA']],
      ['prelim', ['D1 Q1', 'D1 Q2']],
    ])
    expect(results[1]!.quizzes[0]).toMatchObject({
      status: 'counted',
      teams: [
        { name: 'Team A', place: 1, score: 200 },
        { name: 'Team B', place: 3, score: 30 },
        { name: 'Team C', place: 2, score: 100 },
      ],
    })
  })

  it("lists a stage's quizzes in the order people count them", () => {
    const { results } = stats(
      ['D1 Q10', 'D1 Q2', 'D1 Q1'].map((name) => stored(name, 'prelim', fifteenQuestionQuizFile())),
    )
    expect(results[0]!.quizzes.map((q) => q.name)).toEqual(['D1 Q1', 'D1 Q2', 'D1 Q10'])
  })

  it('leaves a quiz that is not counted out of everything', () => {
    const { results, prelimStandings } = stats([stored('D1 Q1', null, fifteenQuestionQuizFile())])
    expect(results).toEqual([])
    expect(prelimStandings!.teams).toEqual([])
  })

  it('says how many teams share a place', () => {
    const quiz = quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'B', 'C'))
    quiz.scored.teams[0]!.place = 1.2
    quiz.scored.teams[1]!.place = 1.2
    expect(stats([quiz]).results[0]!.quizzes[0]!.teams).toEqual([
      expect.objectContaining({ name: 'A', place: 1, tiedWith: 2, score: 100 }),
      expect.objectContaining({ name: 'B', place: 1, tiedWith: 2, score: 60 }),
      { name: 'C', place: 3, score: 20, placementPoints: expect.any(Number), errors: 2 },
    ])
  })

  it("works placement points out from each team's place and score, by the meet's formula", () => {
    const { prelimStandings } = stats([stored('D1 Q1', 'prelim', fifteenQuestionQuizFile())])
    expect(prelimStandings!.teams.map((t) => [t.name, t.placementPoints])).toEqual([
      ['Team A', 20],
      ['Team C', 9],
      ['Team B', 1],
    ])
    expect(prelimStandings!.teams[0]!.lines).toEqual([
      { quiz: 'D1 Q1', stage: 'prelim', place: 1, score: 200, placementPoints: 20, errors: 1 },
    ])
  })

  it("scores teams level in a quiz the meet's way, whatever the quiz file says (FR-023a)", () => {
    // A and B level on 100, each holding a shared first place
    const level = scoredQuiz('A', 'B', 'C')
    level.teams[1]!.score = level.teams[1]!.regulationScore = 100
    level.teams[0]!.place = level.teams[1]!.place = 1.2
    const points = (levelTeams: PlacementFormula) =>
      stats([quizOf('D1 Q1', 'prelim', level)], {
        settings: { ...DEFAULT_STATS_SETTINGS, levelTeams },
      }).prelimStandings!.teams.map((t) => [t.name, t.placementPoints])
    const rulebook = points(PlacementFormula.Rules)
    // The rulebook gives each level team the points of the place they share
    expect(rulebook.slice(0, 2)).toEqual([
      ['A', 10],
      ['B', 10],
    ])
    expect(points(PlacementFormula.Legacy).slice(0, 2)).not.toEqual(rulebook.slice(0, 2))
    expect(points(PlacementFormula.Rules)).toEqual(rulebook)
  })

  it('names a quiz in error, lists it as under review, and adds nothing for it', () => {
    const file = fifteenQuestionQuizFile()
    file.answers = file.answers.filter((a) => a.columnKey !== '15')
    const broken = stored('D1 Q2', 'prelim', file)
    const { results, prelimStandings, warnings } = stats([
      quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'B', 'C')),
      broken,
    ])
    expect(results[0]!.quizzes[1]).toEqual({
      name: 'D1 Q2',
      status: 'underReview',
      teams: [{ name: 'Team A' }, { name: 'Team B' }, { name: 'Team C' }],
      id: broken.id,
      problems: [{ kind: 'unanswered', questions: ['15'] }],
      // The quiz records no question types, so its correct answers by type can't add up
      incompleteTypes: true,
    })
    expect(prelimStandings!.teams.map((t) => t.name)).toEqual(['A', 'B', 'C'])
    expect(prelimStandings!.covers).toEqual({ counted: 1, scheduled: null })
    expect(warnings).toContainEqual({
      kind: 'inError',
      quiz: { id: broken.id, name: 'D1 Q2' },
      problems: [{ kind: 'unanswered', questions: ['15'] }],
    })
  })

  it('carries the standings warnings', () => {
    const { warnings } = stats([
      quizOf('D1 Q1', 'prelim', scoredQuiz('Maple 1', 'Cedar 1', 'Stone 1')),
      quizOf('D1 Q2', 'prelim', scoredQuiz('Maple 1', 'Cedar 1', 'Stome 1')),
    ])
    expect(warnings).toContainEqual({
      kind: 'unequalPrelims',
      division: '1',
      teams: [
        { name: 'Maple 1', quizzes: 2 },
        { name: 'Cedar 1', quizzes: 2 },
        { name: 'Stone 1', quizzes: 1 },
        { name: 'Stome 1', quizzes: 1 },
      ],
    })
    expect(warnings).toContainEqual({
      kind: 'lookAlikeTeams',
      division: '1',
      names: ['Stone 1', 'Stome 1'],
    })
  })
})

describe("divisionStats: a division's quizzers", () => {
  it('ranks the quizzers of every counting quiz but a Finals', () => {
    const { quizzers } = stats([
      stored('D1 Q1', 'prelim', fifteenQuestionQuizFile()),
      stored('D1 QA', 'elimination', fifteenQuestionQuizFile()),
      stored('D1 QF', 'finals', fifteenQuestionQuizFile()),
      stored('D1 Q9', null, fifteenQuestionQuizFile()),
    ])
    expect(quizzers).toMatchObject({ state: 'livePreview', through: 'elimination' })
    expect(quizzers!.lists).toHaveLength(1)
    // A0 scored 70 in each of the two quizzes that count for individuals
    expect(quizzers!.lists[0]!.quizzers[0]).toMatchObject({
      name: 'A0',
      team: 'Team A',
      place: 1,
      points: 140,
      quizzes: 2,
      average: 70,
    })
  })

  it('leaves a quiz in error out of the averages', () => {
    const file = fifteenQuestionQuizFile()
    file.answers = file.answers.filter((a) => a.columnKey !== '15')
    const { quizzers } = stats([
      stored('D1 Q1', 'prelim', fifteenQuestionQuizFile()),
      stored('D1 Q2', 'prelim', file),
    ])
    expect(quizzers!.lists[0]!.quizzers[0]).toMatchObject({ name: 'A0', points: 70, quizzes: 1 })
  })

  it('has no list while nothing counts', () => {
    expect(stats([]).quizzers).toEqual({ state: 'livePreview', through: 'prelim', lists: [] })
  })
})

describe('divisionStats: stages', () => {
  it('ranks the prelim standings over prelims only', () => {
    const { prelimStandings } = stats([
      quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'B', 'C')),
      quizOf('D1 QX', 'intermediate', scoredQuiz('C', 'B', 'A')),
      quizOf('D1 QA', 'elimination', scoredQuiz('C', 'B', 'A')),
      quizOf('D1 QF', 'finals', scoredQuiz('C', 'B', 'A')),
    ])
    expect(prelimStandings!.teams.map((t) => [t.name, t.quizzes])).toEqual([
      ['A', 1],
      ['B', 1],
      ['C', 1],
    ])
  })

  it('marks finalists only where the prelims lead straight to a Finals', () => {
    const prelim = () => quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'B', 'C'))
    const finalists = (table: ReturnType<typeof stats>) =>
      table.prelimStandings!.teams.map((t) => t.finalist)
    expect(finalists(stats([prelim()]))).toEqual([true, true, true])
    // An elimination quiz in the schedule, or one stored, makes the order a seeding
    expect(finalists(stats([prelim()], { laterStagesScheduled: true }))).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(
      finalists(stats([prelim(), quizOf('D1 QA', 'elimination', scoredQuiz('A', 'B', 'C'))])),
    ).toEqual([undefined, undefined, undefined])
  })

  it("re-ranks an intermediate's teams by prelim points plus the intermediate's, within the ranks they held", () => {
    const { rerank } = stats([
      // After the prelims D, E and F hold the third, fifth and sixth ranks between them
      quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'C', 'E')),
      quizOf('D1 Q2', 'prelim', scoredQuiz('B', 'D', 'F')),
      quizOf('D1 Q3', 'prelim', scoredQuiz('A', 'B', 'C')),
      quizOf('D1 Q4', 'prelim', scoredQuiz('D', 'E', 'F')),
      // They play the intermediate, and F, last of them in the prelims, wins it
      quizOf('D1 QX', 'intermediate', scoredQuiz('F', 'E', 'D')),
    ])
    expect(rerank!.teams.map((t) => [t.name, t.rank, t.quizzes])).toEqual([
      ['D', 3, 3],
      ['F', 5, 3],
      ['E', 6, 3],
    ])
    expect(rerank!.teams[1]!.lines.map((line) => [line.quiz, line.stage])).toEqual([
      ['D1 Q2', 'prelim'],
      ['D1 Q4', 'prelim'],
      ['D1 QX', 'intermediate'],
    ])
  })

  it('gives teams the intermediate separates places of their own, though they were level in the prelims', () => {
    const { rerank } = stats([
      // A and D are level first, B and E level third, C and F level fifth
      quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'B', 'C')),
      quizOf('D1 Q2', 'prelim', scoredQuiz('D', 'E', 'F')),
      quizOf('D1 QX', 'intermediate', scoredQuiz('E', 'B', 'C')),
    ])
    expect(rerank!.teams.map((t) => [t.name, t.rank])).toEqual([
      ['E', 3],
      ['B', 4],
      ['C', 5],
    ])
  })

  it("breaks a tie in the re-rank among the line's teams, never against a team outside it", () => {
    const { rerank } = stats([
      // A outside the line is level with B on points; B and C play the intermediate
      quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'B', 'C')),
      quizOf('D1 QX', 'intermediate', scoredQuiz('B', 'C', 'D')),
    ])
    expect(rerank!.teams.map((t) => t.name)).toEqual(['B', 'C', 'D'])
    expect(rerank!.teams.some((t) => t.tied)).toBe(false)
  })

  it('has no re-rank where no intermediate was played', () => {
    expect(stats([quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'B', 'C'))]).rerank).toBeUndefined()
  })

  it("gives a bracket's first three from its Finals, which adds to no standings and no average", () => {
    const { results, prelimStandings, quizzers } = stats([
      stored('D1 Q1', 'prelim', fifteenQuestionQuizFile()),
      stored('D1 QF', 'finals', fifteenQuestionQuizFile()),
    ])
    expect(results[0]).toMatchObject({
      stage: 'finals',
      medals: [{ consolation: false, teams: ['Team A', 'Team C', 'Team B'] }],
    })
    expect(prelimStandings!.teams[0]).toMatchObject({ name: 'Team A', quizzes: 1 })
    expect(quizzers!.lists[0]!.quizzers[0]).toMatchObject({ name: 'A0', quizzes: 1 })
    expect(quizzers!.through).toBe('prelim')
  })

  it('gives no first three where a bracket has two Finals, and says so', () => {
    const first = quizOf('D1 QF', 'finals', scoredQuiz('A', 'B', 'C'))
    const second = quizOf('D1 QG', 'finals', scoredQuiz('C', 'B', 'A'))
    const { results, warnings } = stats([first, second])
    expect(results[0]!.medals).toEqual([])
    expect(warnings).toContainEqual({
      kind: 'twoFinals',
      division: '1',
      consolation: false,
      quizzes: [
        { id: first.id, name: 'D1 QF' },
        { id: second.id, name: 'D1 QG' },
      ],
    })
  })

  it('gives no first three for a Finals left level, which is under review', () => {
    const level = quizOf('D1 QF', 'finals', scoredQuiz('A', 'B', 'C'))
    level.scored.teams[0]!.place = 1.2
    level.scored.teams[1]!.place = 1.2
    const { results, warnings } = stats([level])
    expect(results[0]).toMatchObject({ medals: [], quizzes: [{ status: 'underReview' }] })
    expect(warnings).toContainEqual({
      kind: 'inError',
      quiz: { id: level.id, name: 'D1 QF' },
      problems: [{ kind: 'tieLeftStanding' }],
    })
  })
})

describe('divisionStats: a quiz accepted as scored', () => {
  function broken(): StatsQuiz {
    const file = fifteenQuestionQuizFile()
    // An answer from a seat with no quizzer named
    file.teams[0]!.quizzers[3]!.name = ''
    return stored('D1 Q1', 'prelim', file)
  }

  it('counts, placed by its scores as they stand, and is marked accepted with its errors', () => {
    const { results, prelimStandings, quizzers, warnings } = stats([
      { ...broken(), accepted: true },
    ])
    expect(results[0]!.quizzes[0]).toMatchObject({
      status: 'accepted',
      teams: [
        { name: 'Team A', place: 1 },
        { name: 'Team B', place: 3 },
        { name: 'Team C', place: 2 },
      ],
      problems: [{ kind: 'validation', code: 'empty-seat' }],
    })
    expect(prelimStandings!.teams.map((t) => t.name)).toEqual(['Team A', 'Team C', 'Team B'])
    expect(quizzers!.lists[0]!.quizzers.length).toBeGreaterThan(0)
    expect(warnings).toEqual([])
  })

  it('adds nothing while it is not accepted', () => {
    const { prelimStandings, quizzers } = stats([broken()])
    expect(prelimStandings!.teams).toEqual([])
    expect(quizzers!.lists).toEqual([])
  })
})

describe('divisionStats: a quiz left level in an overtime not played out', () => {
  function undecided(): StatsQuiz {
    const quiz = quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'B', 'C'))
    quiz.scored.teams[1]!.score = 100
    quiz.scored.teams[1]!.regulationScore = 100
    quiz.scored.teams[0]!.place = null
    quiz.scored.teams[1]!.place = null
    quiz.scored.problems = [{ kind: 'undecided' }]
    return quiz
  }

  it('counts once accepted, the level teams sharing the place their scores give them', () => {
    const { prelimStandings, results } = stats([{ ...undecided(), accepted: true }])
    expect(prelimStandings!.teams.map((t) => [t.name, t.rank, t.placementPoints])).toEqual([
      // Level in the quiz, B then falls behind on fewest errors
      ['A', 1, 10],
      ['B', 2, 10],
      ['C', 3, 1],
    ])
    expect(results[0]!.quizzes[0]!.teams.slice(0, 2)).toMatchObject([
      { name: 'A', place: 1, tiedWith: 2 },
      { name: 'B', place: 1, tiedWith: 2 },
    ])
  })

  it('adds nothing until accepted', () => {
    expect(stats([undecided()]).prelimStandings!.teams).toEqual([])
  })

  it("places a two-team quiz's teams without its empty seat", () => {
    const quiz = undecided()
    quiz.scored.teams[0]!.score = -10
    quiz.scored.teams[1]!.score = -10
    // The third seat is empty: no name, no quizzer, and a score of nothing
    Object.assign(quiz.scored.teams[2]!, { name: '', quizzers: [], score: 0, place: null })
    const { results } = stats([{ ...quiz, accepted: true }])
    expect(results[0]!.quizzes[0]!.teams).toMatchObject([
      { name: 'A', place: 1, tiedWith: 2 },
      { name: 'B', place: 1, tiedWith: 2 },
    ])
  })
})

describe('divisionStats: a meet with rosters', () => {
  const roster = [
    { id: 1, name: 'First Church 1', shortName: 'FC 1', quizzers: [] },
    { id: 2, name: 'Grace 1', shortName: 'Grace 1', quizzers: [] },
    { id: 3, name: 'Hope 1', shortName: 'Hope 1', quizzers: [] },
  ]

  it('makes one team of a roster team written by its short name and by its full name', () => {
    const { prelimStandings, results } = stats(
      [
        quizOf('D1 Q1', 'prelim', scoredQuiz('FC 1', 'Grace 1', 'Hope 1')),
        quizOf('D1 Q2', 'prelim', scoredQuiz('first church 1', 'Hope 1', 'Grace 1')),
      ],
      { roster },
    )
    expect(prelimStandings!.teams.map((t) => [t.name, t.quizzes])).toEqual([
      ['First Church 1', 2],
      ['Grace 1', 2],
      ['Hope 1', 2],
    ])
    expect(results[0]!.quizzes[0]!.teams[0]!.name).toBe('First Church 1')
  })

  it('keeps a quiz with a name off the roster out, and names the error', () => {
    const off = quizOf('D1 Q1', 'prelim', scoredQuiz('FC 1', 'Grace 1', 'Faith 2'))
    const { prelimStandings, warnings } = stats([off], { roster })
    expect(prelimStandings!.teams).toEqual([])
    expect(warnings).toEqual([
      {
        kind: 'inError',
        quiz: { id: off.id, name: 'D1 Q1' },
        problems: [{ kind: 'teamNotOnRoster', team: 'Faith 2' }],
      },
    ])
  })
})

describe("divisionStats: the reference meet's second division", () => {
  // The statistician counted the two prelims with slips as they were scored
  const quizzes = referenceMeet.quizzes
    .filter(({ sheet }) => /^D2Q(\d+|X|Y)$/.test(sheet))
    .map(({ sheet, file }) => ({
      ...stored(sheet, /\d$/.test(sheet) ? 'prelim' : 'intermediate', file),
      accepted: true,
    }))

  it('ranks two teams level on prelim points as the workbook did only by points, then errors (SC-002)', () => {
    const prelims = quizzes.filter((quiz) => quiz.stage === 'prelim')
    const theirs = referenceMeet.prelimStandings
      .filter((row) => row.division === '2' && row.placementPoints === 24)
      .sort((a, b) => a.rank - b.rank)
      .map((row) => foldName(row.team))
    expect(theirs).toHaveLength(2)
    const levelOn24 = (tieBreaks: 'rulebook' | 'pointsThenErrors') =>
      stats(prelims, { settings: { ...DEFAULT_STATS_SETTINGS, tieBreaks } })
        .prelimStandings!.teams.filter((t) => t.placementPoints === 24)
        .map((t) => [foldName(t.name), t.decidedBy])
    // The workbook broke this tie by errors; head-to-head would have put the other team first
    expect(levelOn24('pointsThenErrors')).toEqual(theirs.map((team) => [team, 'errors']))
    expect(levelOn24('rulebook').map(([team]) => team)).toEqual([...theirs].reverse())
  })

  it('re-ranks the teams of its intermediates as the meet seeded them', () => {
    const { rerank } = stats(quizzes)
    const theirs = referenceMeet.rerank
      .filter((row) => row.division === '2' && row.newPlace <= 15)
      .sort((a, b) => a.newPlace - b.newPlace)
    expect(theirs).toHaveLength(6)
    expect(rerank!.teams.map((t) => [t.rank, foldName(t.name)])).toEqual(
      theirs.map((row) => [row.newPlace, foldName(row.team)]),
    )
  })
})

describe('divisionStats against the reference meet', () => {
  const prelims = referenceMeet.quizzes.filter(({ sheet }) => /^D1Q\d+$/.test(sheet))
  const { prelimStandings } = stats(prelims.map(({ sheet, file }) => stored(sheet, 'prelim', file)))

  it('ranks the prelims as the standings rank the same quizzes scored afresh', () => {
    const afresh = divisionStandings(
      prelims.map(({ sheet, file }) => ({
        name: sheet,
        teams: quizOutcome(deserialize(file)).teams,
      })),
    )
    expect(prelimStandings!.teams.map(({ lines: _lines, ...team }) => team)).toEqual(afresh.teams)
  })

  it("agrees with the statistician's prelim standings for the division", () => {
    const theirs = referenceMeet.prelimStandings.filter((row) => row.division === '1')
    expect(theirs).toHaveLength(9)
    expect(
      prelimStandings!.teams.map((t) => [foldName(t.name), t.rank, t.placementPoints, t.quizzes]),
    ).toEqual(theirs.map((t) => [foldName(t.team), t.rank, t.placementPoints, t.quizzes]))
  })
})

describe('divisionStats: confirmed orders (FR-019b, FR-019c)', () => {
  const quizzes = [
    quizOf('D1 Q1', 'prelim', scoredQuiz('A', 'B', 'C')),
    quizOf('D1 Q2', 'prelim', scoredQuiz('A', 'C', 'B')),
  ]
  const confirmedNow = () => {
    const { teams } = stats(quizzes).prelimStandings!
    return { teams, by: 'Test Admin', at: '2026-11-18T10:00:00.000Z' }
  }

  it('shows the confirmed prelim order locked in, with who confirmed it', () => {
    const { prelimStandings, warnings } = stats(quizzes, { confirmed: { prelims: confirmedNow() } })
    expect(prelimStandings).toMatchObject({
      state: 'lockedIn',
      confirmed: { by: 'Test Admin', at: '2026-11-18T10:00:00.000Z' },
    })
    expect(prelimStandings!.current).toBeUndefined()
    expect(warnings!.filter((w) => w.kind === 'orderChanged')).toEqual([])
  })

  it('keeps the confirmed order when a prelim changes later, the current one beside it', () => {
    const confirmed = confirmedNow()
    const corrected = [quizzes[0]!, quizOf('D1 Q2', 'prelim', scoredQuiz('C', 'B', 'A'))]
    const { prelimStandings, warnings } = stats(corrected, { confirmed: { prelims: confirmed } })
    expect(prelimStandings!.teams).toEqual(confirmed.teams)
    expect(prelimStandings!.current!.map((t) => t.name)).not.toEqual(
      confirmed.teams.map((t) => t.name),
    )
    expect(warnings).toContainEqual({ kind: 'orderChanged', division: '1', what: 'prelims' })
  })

  it('flags a quiz seated from an order since withdrawn, which still counts', () => {
    const elimination = { ...quizOf('D1 QA', 'elimination', scoredQuiz('A', 'B', 'C')) }
    const { results, warnings } = stats([...quizzes, { ...elimination, withdrawnOrder: true }])
    expect(results[0]!.quizzes[0]).toMatchObject({ status: 'counted', withdrawnOrder: true })
    expect(warnings).toContainEqual({
      kind: 'withdrawnOrder',
      quiz: { id: elimination.id, name: 'D1 QA' },
    })
  })
})

describe('divisionStats: question types', () => {
  it("marks a quiz whose quizzers' correct answers by type don't add up, and not one whose do", () => {
    const untyped = scoredQuiz('A', 'B', 'C')
    untyped.teams[0]!.quizzers = [{ name: 'Q', points: 20, errors: 0, correct: 1, types: {} }]
    const typed = structuredClone(untyped)
    typed.teams[0]!.quizzers[0]!.types = { INT: 1 }
    const [first, second] = stats([
      quizOf('D1 Q1', 'prelim', untyped),
      quizOf('D1 Q2', 'prelim', typed),
    ]).results[0]!.quizzes
    expect(first!.incompleteTypes).toBe(true)
    expect(second!.incompleteTypes).toBeUndefined()
  })
})

describe('divisionStats: quizzer standings by stage (FR-018a)', () => {
  it('covers only the quizzes up to the stage given, as they now stand', () => {
    const quizzes = [
      stored('D1 Q1', 'prelim', fifteenQuestionQuizFile()),
      stored('D1 QA', 'elimination', fifteenQuestionQuizFile()),
    ]
    const through = (quizzersThrough?: 'prelim' | 'elimination') =>
      stats(quizzes, { quizzersThrough }).quizzers!
    expect(through('prelim')).toMatchObject({ through: 'prelim' })
    expect(through('prelim').lists[0]!.quizzers[0]!.quizzes).toBe(1)
    expect(through().lists[0]!.quizzers[0]!.quizzes).toBe(2)
  })
})

describe('divisionStats: what needs attention (FR-030, FR-032)', () => {
  /** A quiz Maple 1 won, with the quizzers given on Maple 1 */
  function withQuizzers(...names: string[]): StatsQuiz {
    const scored = scoredQuiz('Maple 1', 'Cedar 1', 'Stone 1')
    scored.teams[0]!.quizzers = names.map((name) => ({
      name,
      points: 20,
      errors: 0,
      correct: 1,
      types: { INT: 1 },
    }))
    return quizOf('D1 Q1', 'prelim', scored)
  }

  it('flags two quizzer names on one team that look alike, and not two that differ', () => {
    const { warnings } = stats([
      withQuizzers('Jordan Lee', 'Sam Park'),
      { ...withQuizzers('Jordon Lee', 'Sam Park'), name: 'D1 Q2', key: 'D1 Q2' },
    ])
    expect(warnings!.filter((w) => w.kind === 'lookAlikeQuizzers')).toEqual([
      {
        kind: 'lookAlikeQuizzers',
        division: '1',
        team: 'Maple 1',
        names: ['Jordan Lee', 'Jordon Lee'],
      },
    ])
  })

  it('never flags two names that quizzed together in one quiz', () => {
    const { warnings } = stats([withQuizzers('Jordan Lee', 'Jordon Lee')])
    expect(warnings!.filter((w) => w.kind === 'lookAlikeQuizzers')).toEqual([])
  })

  it('leaves out a pair an admin dismissed, whichever way round it was dismissed', () => {
    const { warnings } = stats(
      [
        withQuizzers('Jordan Lee'),
        { ...withQuizzers('Jordon Lee'), name: 'D1 Q3', key: 'D1 Q3' },
        quizOf('D1 Q2', 'prelim', scoredQuiz('Maple 1', 'Cedar 1', 'Stome 1')),
      ],
      {
        dismissed: [
          nameDismissal('maple 1', ['Jordon Lee', 'Jordan Lee']),
          nameDismissal(null, ['Stome 1', 'Stone 1']),
        ],
      },
    )
    expect(warnings!.filter((w) => w.kind.startsWith('lookAlike'))).toEqual([])
  })

  it("adds a division's quizzer counts and incomplete types to its warnings", () => {
    const short = withQuizzers('Jordan Lee')
    short.scored!.teams[0]!.quizzers[0]!.types = {}
    const items = attentionOf(
      stats([withQuizzers('Jordan Lee', 'Sam Park'), { ...short, name: 'D1 Q2', key: 'D1 Q2' }]),
    )
    expect(items).toContainEqual({ kind: 'incompleteTypes', quiz: { id: short.id, name: 'D1 Q2' } })
    expect(items).toContainEqual({
      kind: 'quizzerCount',
      division: '1',
      team: 'Maple 1',
      quizzer: 'Sam Park',
      listed: 1,
      teamQuizzes: 2,
      missing: [{ id: short.id, name: 'D1 Q2' }],
    })
  })
})
