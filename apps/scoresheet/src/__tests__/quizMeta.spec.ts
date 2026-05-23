import { describe, it, expect } from 'vitest'
import { quizNumberFromScheduledQuiz, consolationFromScheduledQuiz } from '../quizMeta'

describe('quizNumberFromScheduledQuiz', () => {
  it('returns bracketLabel for elim quizzes', () => {
    expect(
      quizNumberFromScheduledQuiz({
        phase: 'elim',
        lane: 'main',
        label: 'D1-QA',
        bracketLabel: 'A',
      }),
    ).toBe('A')
  })

  it('strips the D{div}-Q prefix for prelim labels', () => {
    expect(
      quizNumberFromScheduledQuiz({
        phase: 'prelim',
        lane: null,
        label: 'D1-Q1',
        bracketLabel: null,
      }),
    ).toBe('1')
    expect(
      quizNumberFromScheduledQuiz({
        phase: 'prelim',
        lane: null,
        label: 'D2-Q14',
        bracketLabel: null,
      }),
    ).toBe('14')
  })

  it('falls back to the raw label when the format is unrecognised', () => {
    expect(
      quizNumberFromScheduledQuiz({
        phase: 'prelim',
        lane: null,
        label: 'Final Round Showcase',
        bracketLabel: null,
      }),
    ).toBe('Final Round Showcase')
  })
})

describe('consolationFromScheduledQuiz', () => {
  it('returns true only for consolation lanes', () => {
    expect(consolationFromScheduledQuiz({ lane: 'consolation' })).toBe(true)
    expect(consolationFromScheduledQuiz({ lane: 'main' })).toBe(false)
    expect(consolationFromScheduledQuiz({ lane: 'intermediate' })).toBe(false)
    expect(consolationFromScheduledQuiz({ lane: null })).toBe(false)
  })
})
