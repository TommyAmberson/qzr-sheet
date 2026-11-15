import { describe, it, expect } from 'vitest'
import { createQuizStore } from '../quizStore'
import { toQuizzerId } from '@qzr/shared'

describe('editable names', () => {
  // --- Team names ---

  it('teams start with no name', () => {
    const store = createQuizStore()
    expect(store.teams.map((t) => t.name)).toEqual(['', '', ''])
  })

  it('setTeamName updates a team name', () => {
    const store = createQuizStore()
    store.setTeamName(store.teams[0]!.id, 'Eagles')
    expect(store.teams[0]!.name).toBe('Eagles')
  })

  it('setTeamName does nothing for unknown team', () => {
    const store = createQuizStore()
    store.setTeamName(999, 'Nope')
    // No crash, names unchanged
    expect(store.teams.map((t) => t.name)).toEqual(['', '', ''])
  })

  it('setTeamName allows empty string', () => {
    const store = createQuizStore()
    store.setTeamName(store.teams[1]!.id, '')
    expect(store.teams[1]!.name).toBe('')
  })

  // --- Quizzer names ---

  it('quizzers start with no name', () => {
    const store = createQuizStore()
    for (const team of store.teams) {
      expect(store.quizzersByTeam(team.id).map((q) => q.name)).toEqual(['', '', '', '', ''])
    }
  })

  it('setQuizzerName updates a quizzer name', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setQuizzerName(qzr.id, 'Alice')
    expect(qzr.name).toBe('Alice')
  })

  it('setQuizzerName does nothing for unknown quizzer', () => {
    const store = createQuizStore()
    store.setQuizzerName(toQuizzerId(999), 'Nope')
    // No crash, and every seat still blank
    for (const team of store.teams) {
      expect(store.quizzersByTeam(team.id).map((q) => q.name)).toEqual(['', '', '', '', ''])
    }
  })

  it('setQuizzerName allows empty string', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[2]!
    store.setQuizzerName(qzr.id, '')
    expect(qzr.name).toBe('')
  })

  it('setting multiple quizzer names works independently', () => {
    const store = createQuizStore()
    const qzrs = store.quizzersByTeam(store.teams[0]!.id)
    store.setQuizzerName(qzrs[0]!.id, 'Alice')
    store.setQuizzerName(qzrs[1]!.id, 'Bob')
    expect(qzrs[0]!.name).toBe('Alice')
    expect(qzrs[1]!.name).toBe('Bob')
    expect(qzrs[2]!.name).toBe('')
  })
})
