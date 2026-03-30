import { describe, it, expect, beforeEach } from 'vitest'
import { saveToStorage, loadFromStorage, clearStorage } from '../autoSave'
import { createQuizStore } from '../../stores/quizStore'
import { CellValue } from '../../types/scoresheet'

beforeEach(() => localStorage.clear())

describe('autoSave', () => {
  it('returns null when nothing is stored', () => {
    expect(loadFromStorage()).toBeNull()
  })

  it('round-trips a default store', () => {
    const store = createQuizStore()
    saveToStorage(store, new Map())
    const result = loadFromStorage()
    expect(result).not.toBeNull()
    expect(result!.quiz.division).toBe(store.quiz.division)
    expect(result!.teams).toHaveLength(3)
  })

  it('round-trips answers and noJumps', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setAnswer(qzr.id, '1', CellValue.Correct)
    const noJumps = new Map([['3', true]])
    saveToStorage(store, noJumps)

    const result = loadFromStorage()!
    expect(result.answers).toHaveLength(1)
    expect(result.answers[0]!.value).toBe(CellValue.Correct)
    expect(result.noJumps.get('3')).toBe(true)
  })

  it('clearStorage removes persisted data', () => {
    const store = createQuizStore()
    saveToStorage(store, new Map())
    clearStorage()
    expect(loadFromStorage()).toBeNull()
  })

  it('returns null and cleans up on corrupt data', () => {
    localStorage.setItem('qzr-sheet:current', '{bad json')
    expect(loadFromStorage()).toBeNull()
    expect(localStorage.getItem('qzr-sheet:current')).toBeNull()
  })
})
