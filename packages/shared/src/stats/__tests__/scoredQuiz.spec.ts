import { describe, it, expect } from 'vitest'
import { foldName } from '../../results'
import { ValidationCode } from '../../scoring/validation'
import { CellValue } from '../../quizFile'
import { fifteenQuestionQuizFile } from '../../scoring/__tests__/fixtures/fifteenQuestionQuiz'
import {
  REFERENCE_TYPES,
  SHEETS_WITH_SLIPS,
  referenceMeet,
} from '../../scoring/__tests__/fixtures/referenceMeet'
import { scoreStoredQuiz, type ScoredQuiz } from '../scoredQuiz'

describe('scoreStoredQuiz', () => {
  it("gives each team's name, score, errors and place by score", () => {
    const scored = scoreStoredQuiz(fifteenQuestionQuizFile())
    expect(
      scored.teams.map(({ name, score, regulationScore, errors, place }) => ({
        name,
        score,
        regulationScore,
        errors,
        place,
      })),
    ).toEqual([
      { name: 'Team A', score: 200, regulationScore: 200, errors: 1, place: 1 },
      { name: 'Team B', score: 30, regulationScore: 30, errors: 3, place: 3 },
      { name: 'Team C', score: 100, regulationScore: 100, errors: 2, place: 2 },
    ])
    expect(scored.problems).toEqual([])
    expect(scored.name).toBe('D1 Q1')
  })

  it("gives each named quizzer's points, errors and correct answers, bonuses adding nothing", () => {
    const [teamA] = scoreStoredQuiz(fifteenQuestionQuizFile()).teams
    // A0: three correct with no error (60 and the quiz-out bonus); the bonus answered on 6 is the team's
    expect(teamA!.quizzers[0]).toEqual({ name: 'A0', points: 70, errors: 0, correct: 3, types: {} })
    expect(teamA!.quizzers).toHaveLength(5)
  })

  it('leaves out a seat with no quizzer named', () => {
    const file = fifteenQuestionQuizFile()
    file.teams[2]!.quizzers[4]!.name = ' '
    expect(scoreStoredQuiz(file).teams[2]!.quizzers.map((q) => q.name)).toEqual([
      'C0',
      'C1',
      'C2',
      'C3',
    ])
  })

  it('counts correct answers by the question types the quiz records', () => {
    const file = fifteenQuestionQuizFile()
    file.quiz.questionTypes = [
      ['1', 'INT'],
      ['2', 'INT'],
      ['3', 'FTV'],
      ['6', 'MA'],
    ] as typeof file.quiz.questionTypes
    // A0 answered 1, 2 and 3 correctly; 6 was a bonus, which is not a correct answer of theirs
    expect(scoreStoredQuiz(file).teams[0]!.quizzers[0]!.types).toEqual({ INT: 2, FTV: 1 })
  })

  it("keeps no placement points, which the meet's way of scoring level teams decides", () => {
    expect(JSON.stringify(scoreStoredQuiz(fifteenQuestionQuizFile()))).not.toContain(
      'placementPoints',
    )
  })

  it('lists every validation error with its team, quizzer, question and code', () => {
    const file = fifteenQuestionQuizFile()
    // An answer from a seat with no quizzer named: A3 answered on 12A
    file.teams[0]!.quizzers[3]!.name = ''
    const scored = scoreStoredQuiz(file)
    expect(scored.problems).toContainEqual({
      kind: 'validation',
      team: 'Team A',
      quizzer: '',
      question: '12A',
      code: ValidationCode.EmptySeat,
    })
    // Places are still given, since a quiz accepted as scored is placed by them
    expect(scored.teams.map((t) => t.place)).toEqual([1, 3, 2])
  })

  it('calls a quiz undecided while teams are level in an overtime not played out', () => {
    const file = fifteenQuestionQuizFile()
    // Nobody jumped on anything, so every team has its on-time 20, and overtime is on
    file.answers = []
    file.noJumps = Array.from({ length: 15 }, (_, i) => String(i + 1))
    file.quiz.overtime = true
    const scored = scoreStoredQuiz(file)
    expect(scored.problems).toEqual([{ kind: 'undecided' }])
    expect(scored.teams.map((t) => t.place)).toEqual([null, null, null])
  })

  it('says whether overtime was played, not merely switched on', () => {
    const file = fifteenQuestionQuizFile()
    file.quiz.overtime = true
    expect(scoreStoredQuiz(file).overtimePlayed).toBe(false)
    file.answers.push({ quizzerId: 10, columnKey: '16', value: CellValue.Correct })
    expect(scoreStoredQuiz(file).overtimePlayed).toBe(true)
  })

  it('names the unanswered questions', () => {
    const file = fifteenQuestionQuizFile()
    file.answers = file.answers.filter((a) => a.columnKey !== '15')
    expect(scoreStoredQuiz(file).problems).toEqual([{ kind: 'unanswered', questions: ['15'] }])
  })
})

describe('scoreStoredQuiz against the reference meet', () => {
  const scored = new Map<string, ScoredQuiz>(
    referenceMeet.quizzes.map(({ sheet, file }) => [sheet, scoreStoredQuiz(file)]),
  )
  const teamOf = (sheet: string, team: string) =>
    scored.get(sheet)!.teams.find((t) => foldName(t.name) === foldName(team))

  it('finds errors in the sheets with slips and in no other', () => {
    const withProblems = [...scored].filter(([, quiz]) => quiz.problems.length > 0).map(([s]) => s)
    expect(withProblems.sort()).toEqual([...SHEETS_WITH_SLIPS].sort())
  })

  it("agrees with the statistician's row for every quizzer in every quiz", () => {
    expect(referenceMeet.quizzerRows.length).toBeGreaterThan(800)
    const differing = referenceMeet.quizzerRows.flatMap((row) => {
      const quizzer = teamOf(row.sheet, row.team)?.quizzers.find(
        (q) => foldName(q.name) === foldName(row.quizzer),
      )
      // The workbook has a row of zeros for a quizzer who sat a quiz out; the sheet doesn't list them
      const ours = {
        points: quizzer?.points ?? 0,
        errors: quizzer?.errors ?? 0,
        jumps: quizzer ? quizzer.correct + quizzer.errors : 0,
        types: REFERENCE_TYPES.map((type) => quizzer?.types[type] ?? 0),
      }
      const theirs = { points: row.points, errors: row.errors, jumps: row.jumps, types: row.types }
      return JSON.stringify(ours) === JSON.stringify(theirs) ? [] : [{ row, ours }]
    })
    expect(differing).toEqual([])
  })

  it("agrees with the statistician's score, errors and place for every team row", () => {
    expect(referenceMeet.teamRows).toHaveLength(123)
    const differing = referenceMeet.teamRows.flatMap((row) => {
      const team = teamOf(row.sheet, row.team)
      const ours = team && { score: team.regulationScore, errors: team.errors, place: team.place }
      const theirs = { score: row.score, errors: row.errors, place: row.place }
      return JSON.stringify(ours) === JSON.stringify(theirs) ? [] : [{ row, ours }]
    })
    expect(differing).toEqual([])
  })
})
