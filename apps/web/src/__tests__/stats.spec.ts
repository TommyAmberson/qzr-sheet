import { describe, it, expect } from 'vitest'
import { ValidationCode, type QuizProblem } from '@qzr/shared'
import { placeLabel, problemText, warningText } from '../stats'

describe('placeLabel', () => {
  it('names a place, and says when teams share it', () => {
    expect(placeLabel(2)).toBe('2nd')
    expect(placeLabel(1, 2)).toBe('tied 1st')
  })
})

describe('problemText', () => {
  it('says where a validation error is and what it is', () => {
    expect(
      problemText({
        kind: 'validation',
        team: 'Maple Hill 1',
        quizzer: 'Alex Abbott',
        question: '16A',
        code: ValidationCode.NoJump,
      }),
    ).toMatch(/^Maple Hill 1, Alex Abbott, question 16A: \S/)
  })

  it("names only the team for an error that is the team's", () => {
    expect(
      problemText({
        kind: 'validation',
        team: 'Maple Hill 1',
        quizzer: null,
        question: null,
        code: ValidationCode.TooManyTimeouts,
      }),
    ).toMatch(/^Maple Hill 1: \S/)
  })

  it('lists the unanswered questions', () => {
    expect(problemText({ kind: 'unanswered', questions: ['15'] })).toBe(
      'Question 15 has no answer.',
    )
    expect(problemText({ kind: 'unanswered', questions: ['14', '15'] })).toBe(
      'Questions 14, 15 have no answer.',
    )
  })
})

describe('warningText', () => {
  it('names a quiz in error and how many errors it has', () => {
    const quiz = { id: 1, name: 'D1 Q3' }
    const problem: QuizProblem = { kind: 'unanswered', questions: ['15'] }
    expect(warningText({ kind: 'inError', quiz, problems: [problem] })).toBe(
      'D1 Q3 has an error, so it adds nothing.',
    )
    expect(warningText({ kind: 'inError', quiz, problems: [problem, problem] })).toBe(
      'D1 Q3 has 2 errors, so it adds nothing.',
    )
  })

  it("gives each team's count when prelims are unequal", () => {
    expect(
      warningText({
        kind: 'unequalPrelims',
        division: '1',
        teams: [
          { name: 'Maple Hill 1', quizzes: 3 },
          { name: 'Cedar Grove 1', quizzes: 2 },
        ],
      }),
    ).toBe(
      'Teams have played different numbers of counted quizzes: Maple Hill 1 3, Cedar Grove 1 2.',
    )
  })
})
