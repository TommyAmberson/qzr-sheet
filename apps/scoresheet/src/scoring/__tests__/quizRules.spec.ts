import { describe, it, expect } from 'vitest'
import {
  TWENTY_QUESTION_RULES,
  firstOvertimeQuestion,
  lastTimeoutQuestion,
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
