import { describe, it, expect } from 'vitest'
import { createQuizStore } from '../quizStore'
import { QuestionCategory } from '../../types/scoresheet'

describe('questionTypes', () => {
  it('starts with no question types set', () => {
    const store = createQuizStore()
    expect(store.quiz.questionTypes.size).toBe(0)
  })

  it('setQuestionType stores a category for a column key', () => {
    const store = createQuizStore()
    store.setQuestionType('1', QuestionCategory.INT)
    expect(store.quiz.questionTypes.get('1')).toBe(QuestionCategory.INT)
  })

  it('setQuestionType overwrites an existing category', () => {
    const store = createQuizStore()
    store.setQuestionType('1', QuestionCategory.INT)
    store.setQuestionType('1', QuestionCategory.FTV)
    expect(store.quiz.questionTypes.get('1')).toBe(QuestionCategory.FTV)
  })

  it('setQuestionType with null clears the category', () => {
    const store = createQuizStore()
    store.setQuestionType('1', QuestionCategory.INT)
    store.setQuestionType('1', null)
    expect(store.quiz.questionTypes.has('1')).toBe(false)
  })

  it('multiple columns can have different categories', () => {
    const store = createQuizStore()
    store.setQuestionType('1', QuestionCategory.INT)
    store.setQuestionType('5', QuestionCategory.MA)
    store.setQuestionType('16', QuestionCategory.SIT)
    expect(store.quiz.questionTypes.get('1')).toBe(QuestionCategory.INT)
    expect(store.quiz.questionTypes.get('5')).toBe(QuestionCategory.MA)
    expect(store.quiz.questionTypes.get('16')).toBe(QuestionCategory.SIT)
    expect(store.quiz.questionTypes.size).toBe(3)
  })
})
