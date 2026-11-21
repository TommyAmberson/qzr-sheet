import { describe, it, expect } from 'vitest'
import { CellValue } from '../../quizFile'
import { deserialize } from '../../quizFileCodec'
import { answerLookup } from '../cellGrid'
import { overtimeRoundsNeeded, quizOutcome } from '../quizOutcome'
import { fifteenQuestionQuizFile } from './fixtures/fifteenQuestionQuiz'

describe('quizOutcome', () => {
  it('scores and places the hand-scored 15-question quiz from its file', () => {
    const outcome = quizOutcome(deserialize(fifteenQuestionQuizFile()))
    expect(outcome.placed).toBe(true)
    expect(outcome.teams).toEqual([
      { name: 'Team A', score: 200, place: 1, placementPoints: 20, errors: 1 },
      { name: 'Team B', score: 30, place: 3, placementPoints: 1, errors: 3 },
      { name: 'Team C', score: 100, place: 2, placementPoints: 9, errors: 2 },
    ])
  })

  it('counts every error, whether or not it cost points, and no fouls', () => {
    // Team B: free errors on 4 and 11, error points on 13, and a foul on 9
    const outcome = quizOutcome(deserialize(fifteenQuestionQuizFile()))
    expect(outcome.teams[1]!.errors).toBe(3)
  })

  it("can't place a quiz with an unanswered regulation question", () => {
    const file = fifteenQuestionQuizFile()
    file.answers = file.answers.filter((a) => a.columnKey !== '15')
    const outcome = quizOutcome(deserialize(file))
    expect(outcome.placed).toBe(false)
    expect(outcome.teams.map((t) => t.place)).toEqual([null, null, null])
    expect(outcome.teams.map((t) => t.placementPoints)).toEqual([null, null, null])
    expect(outcome.teams[1]!.score).toBe(10)
  })

  it("can't place a quiz with a validation error", () => {
    const file = fifteenQuestionQuizFile()
    // An answer from a seat with no quizzer named is a validation error
    file.teams[0]!.quizzers[4]!.name = ''
    expect(quizOutcome(deserialize(file)).placed).toBe(false)
  })

  it('keeps an overtime round that holds answers, though the scoring needs none', () => {
    // Not tied after 15, so no overtime is needed; an answer in the second round (19 to 21), as a
    // scoresheet on an older rule might have played, still keeps that round
    const file = fifteenQuestionQuizFile()
    file.quiz.overtime = true
    file.answers.push({
      quizzerId: file.teams[0]!.quizzers[0]!.id,
      columnKey: '19',
      value: CellValue.Correct,
    })
    const { quiz, teams, quizzers, answers, noJumps } = deserialize(file)
    expect(overtimeRoundsNeeded(quiz, teams, quizzers, answerLookup(answers), noJumps)).toBe(2)
  })
})
