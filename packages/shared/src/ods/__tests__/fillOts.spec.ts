import { describe, it, expect } from 'vitest'
import { fillOts } from '../fillOts'
import { fifteenQuestionQuizFile } from '../../scoring/__tests__/fixtures/fifteenQuestionQuiz'

describe('fillOts', () => {
  it('refuses a 15-question quiz, which the template cannot score', () => {
    expect(() => fillOts(new Uint8Array(), fifteenQuestionQuizFile())).toThrow(
      /20-question quizzes only/,
    )
  })
})
