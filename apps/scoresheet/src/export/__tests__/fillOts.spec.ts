import { describe, it, expect } from 'vitest'
import { fillOts } from '../fillOts'
import { serializeStore } from '../../persistence/quizFile'
import { createQuizStore } from '../../stores/quizStore'
import { QuizFormat } from '@qzr/shared'

describe('fillOts', () => {
  it('refuses a 15-question quiz, which the template cannot score', () => {
    const store = createQuizStore()
    store.quiz.format = QuizFormat.FifteenQuestion
    const file = JSON.parse(serializeStore(store, new Map(), new Map()))
    expect(() => fillOts(new Uint8Array(), file)).toThrow(/20-question quizzes only/)
  })
})
