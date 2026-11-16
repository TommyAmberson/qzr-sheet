import { describe, it, expect } from 'vitest'
import { PlacementFormula, type QuizFile } from '../../quizFile'
import { deserialize } from '../../quizFileCodec'
import { foldName } from '../../results'
import { quizOutcome } from '../../scoring/quizOutcome'
import { divisionStandings } from '../../scoring/standings'
import { fifteenQuestionQuizFile } from '../../scoring/__tests__/fixtures/fifteenQuestionQuiz'
import { referenceMeet } from '../../scoring/__tests__/fixtures/referenceMeet'
import { divisionStats, type Stage, type StatsQuiz } from '../divisionStats'
import { scoreStoredQuiz, type ScoredQuiz } from '../scoredQuiz'

let nextId = 1
function stored(name: string, stage: Stage | null, file: QuizFile): StatsQuiz {
  return { id: nextId++, name, stage, scored: scoreStoredQuiz(file) }
}
function stats(quizzes: StatsQuiz[]) {
  return divisionStats({ division: '1', state: 'prelim_running', phase: 'live', quizzes })
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
    const quiz: StatsQuiz = {
      id: 1,
      name: 'D1 Q1',
      stage: 'prelim',
      scored: scoredQuiz('A', 'B', 'C'),
    }
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
      { id: 90, name: 'D1 Q1', stage: 'prelim', scored: scoredQuiz('A', 'B', 'C') },
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
      {
        id: 1,
        name: 'D1 Q1',
        stage: 'prelim',
        scored: scoredQuiz('Maple 1', 'Cedar 1', 'Stone 1'),
      },
      {
        id: 2,
        name: 'D1 Q2',
        stage: 'prelim',
        scored: scoredQuiz('Maple 1', 'Cedar 1', 'Stome 1'),
      },
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

describe('divisionStats against the reference meet', () => {
  const prelims = referenceMeet.quizzes.filter(({ sheet }) => /^D1Q\d+$/.test(sheet))
  const { prelimStandings } = stats(prelims.map(({ sheet, file }) => stored(sheet, 'prelim', file)))

  it('ranks the prelims as the standings rank the same quizzes scored afresh', () => {
    const afresh = divisionStandings(
      prelims.map(({ sheet, file }) => ({ name: sheet, outcome: quizOutcome(deserialize(file)) })),
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
