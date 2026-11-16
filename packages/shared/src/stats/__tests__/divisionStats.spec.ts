import { describe, it, expect } from 'vitest'
import { PlacementFormula, type QuizFile } from '../../quizFile'
import { deserialize } from '../../quizFileCodec'
import { foldName } from '../../results'
import { quizOutcome } from '../../scoring/quizOutcome'
import { divisionStandings } from '../../scoring/standings'
import { fifteenQuestionQuizFile } from '../../scoring/__tests__/fixtures/fifteenQuestionQuiz'
import { referenceMeet } from '../../scoring/__tests__/fixtures/referenceMeet'
import { divisionStats, type DivisionStatsInput, type StatsQuiz } from '../divisionStats'
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
  more: Partial<Pick<DivisionStatsInput, 'roster' | 'laterStagesScheduled'>> = {},
) {
  return divisionStats({
    division: '1',
    state: 'prelim_running',
    phase: 'live',
    quizzes,
    roster: null,
    laterStagesScheduled: false,
    ...more,
  })
}

/** A quiz three teams finished in the order given, 100, 60 and 20 points */
function scoredQuiz(first: string, second: string, third: string): ScoredQuiz {
  return {
    name: 'D1 Q1',
    consolation: false,
    formula: PlacementFormula.Rules,
    teams: [first, second, third].map((name, i) => ({
      name,
      score: 100 - i * 40,
      regulationScore: 100 - i * 40,
      errors: i,
      place: (i + 1) as 1 | 2 | 3,
      quizzers: [],
    })),
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
      { name: 'A', place: 1, tiedWith: 2, score: 100 },
      { name: 'B', place: 1, tiedWith: 2, score: 60 },
      { name: 'C', place: 3, score: 20 },
    ])
  })

  it("works placement points out from each team's place and score, by the quiz's formula", () => {
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
