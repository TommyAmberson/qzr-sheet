import { describe, it, expect } from 'vitest'
import { createQuizStore } from '../quizStore'
import { CellValue } from '../../types/scoresheet'
import { toQuizzerId } from '../../types/indices'

const C = CellValue.Correct
const _ = CellValue.Empty

describe('empty seat', () => {
  it('isQuizzerUnnamed returns false for named quizzers, true for 5th (empty seat)', () => {
    const store = createQuizStore()
    for (const team of store.teams) {
      const qzrs = store.quizzersByTeam(team.id)
      for (let i = 0; i < 4; i++) {
        expect(store.isQuizzerUnnamed(qzrs[i]!.id)).toBe(false)
      }
      expect(store.isQuizzerUnnamed(qzrs[4]!.id)).toBe(true)
    }
  })

  it('isQuizzerUnnamed returns true for empty string name', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setQuizzerName(qzr.id, '')
    expect(store.isQuizzerUnnamed(qzr.id)).toBe(true)
  })

  it('isQuizzerUnnamed returns true for whitespace-only name', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setQuizzerName(qzr.id, '   ')
    expect(store.isQuizzerUnnamed(qzr.id)).toBe(true)
  })

  it('isQuizzerUnnamed returns false for non-empty name', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setQuizzerName(qzr.id, 'Alice')
    expect(store.isQuizzerUnnamed(qzr.id)).toBe(false)
  })

  it('isQuizzerUnnamed returns false for unknown quizzer', () => {
    const store = createQuizStore()
    expect(store.isQuizzerUnnamed(toQuizzerId(999))).toBe(false)
  })

  it('empty seat quizzer cells are all empty in grid', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    const qzrs = store.quizzersByTeam(team.id)
    // Give quizzer 1 (seat 0) an answer, then clear their name
    store.setAnswer(qzrs[0]!.id, '1', C)
    store.setQuizzerName(qzrs[0]!.id, '')

    // The answer is still stored but the quizzer is an empty seat
    expect(store.isQuizzerUnnamed(qzrs[0]!.id)).toBe(true)
    expect(store.getAnswer(qzrs[0]!.id, '1')).toBe(C)
  })
})
