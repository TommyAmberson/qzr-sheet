import { describe, it, expect } from 'vitest'
import { QuizFormat } from '@qzr/shared'
import {
  TWENTY_QUESTION_RULES,
  firstOvertimeQuestion,
  lastTimeoutQuestion,
  quizRules,
  lastQuestionThroughRound,
  otRoundRange,
  endsRound,
  startsOtRound,
  type QuizRules,
} from '../quizRules'

function expectConsistent(rules: QuizRules) {
  expect(rules.firstAbQuestion).toBeLessThan(rules.firstErrorPointsQuestion)
  expect(rules.firstErrorPointsQuestion).toBeLessThanOrEqual(rules.regulationQuestions)
}

describe('TWENTY_QUESTION_RULES', () => {
  it('matches the rulebook 20-question quiz', () => {
    expect(TWENTY_QUESTION_RULES).toEqual({
      regulationQuestions: 20,
      firstAbQuestion: 16,
      firstErrorPointsQuestion: 17,
      quizOutCorrect: 4,
      overtimeRoundSize: 3,
    })
  })

  it('starts overtime at 21 and allows timeouts through 16', () => {
    expect(firstOvertimeQuestion(TWENTY_QUESTION_RULES)).toBe(21)
    expect(lastTimeoutQuestion(TWENTY_QUESTION_RULES)).toBe(16)
  })

  it('is internally consistent', () => {
    expectConsistent(TWENTY_QUESTION_RULES)
  })
})

describe('quizRules', () => {
  it('gives the 15-question quiz its shifted rules', () => {
    expect(quizRules(QuizFormat.FifteenQuestion)).toEqual({
      regulationQuestions: 15,
      firstAbQuestion: 11,
      firstErrorPointsQuestion: 12,
      quizOutCorrect: 3,
      overtimeRoundSize: 3,
    })
  })

  it('starts 15-question overtime at 16 and allows timeouts through 11', () => {
    const rules = quizRules(QuizFormat.FifteenQuestion)
    expect(firstOvertimeQuestion(rules)).toBe(16)
    expect(lastTimeoutQuestion(rules)).toBe(11)
  })

  it('gives the 20-question quiz the 20-question rules', () => {
    expect(quizRules(QuizFormat.TwentyQuestion)).toBe(TWENTY_QUESTION_RULES)
  })

  it.each(Object.values(QuizFormat))('%s rules are internally consistent', (format) => {
    expectConsistent(quizRules(format))
  })
})

describe('overtime round helpers', () => {
  const FIFTEEN = quizRules(QuizFormat.FifteenQuestion)

  it('finds the last question through a number of rounds', () => {
    expect(lastQuestionThroughRound(TWENTY_QUESTION_RULES, 0)).toBe(20)
    expect(lastQuestionThroughRound(TWENTY_QUESTION_RULES, 2)).toBe(26)
    expect(lastQuestionThroughRound(FIFTEEN, 1)).toBe(18)
  })

  it('gives each overtime round its question range', () => {
    expect(otRoundRange(TWENTY_QUESTION_RULES, 0)).toEqual({ firstQ: 21, lastQ: 23 })
    expect(otRoundRange(FIFTEEN, 1)).toEqual({ firstQ: 19, lastQ: 21 })
  })

  it('marks the questions that end regulation or a round', () => {
    const ends = Array.from({ length: 30 }, (_, i) => i + 1).filter((n) => endsRound(FIFTEEN, n))
    expect(ends).toEqual([15, 18, 21, 24, 27, 30])
  })

  it('marks the questions that start an overtime round', () => {
    const starts = Array.from({ length: 30 }, (_, i) => i + 1).filter((n) =>
      startsOtRound(TWENTY_QUESTION_RULES, n),
    )
    expect(starts).toEqual([21, 24, 27, 30])
  })
})
