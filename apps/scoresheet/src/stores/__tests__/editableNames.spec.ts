import { describe, it, expect } from 'vitest'
import { createQuizStore } from '../quizStore'

describe('editable names', () => {
  // --- Team names ---

  it('teams have default names', () => {
    const store = createQuizStore()
    expect(store.teams[0]!.name).toBe('Team 1')
    expect(store.teams[1]!.name).toBe('Team 2')
    expect(store.teams[2]!.name).toBe('Team 3')
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
    expect(store.teams.map((t) => t.name)).toEqual(['Team 1', 'Team 2', 'Team 3'])
  })

  it('setTeamName allows empty string', () => {
    const store = createQuizStore()
    store.setTeamName(store.teams[1]!.id, '')
    expect(store.teams[1]!.name).toBe('')
  })

  // --- Quizzer names ---

  it('quizzers have default names (5th is empty seat)', () => {
    const store = createQuizStore()
    for (const team of store.teams) {
      const quizzers = store.quizzersByTeam(team.id)
      for (let i = 0; i < 4; i++) {
        expect(quizzers[i]!.name).toBe(`Quizzer ${i + 1}`)
      }
      expect(quizzers[4]!.name).toBe('')
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
    store.setQuizzerName(999, 'Nope')
    // No crash — first 4 still have names, 5th still empty
    for (const team of store.teams) {
      const quizzers = store.quizzersByTeam(team.id)
      for (let i = 0; i < 4; i++) {
        expect(quizzers[i]!.name).toBe(`Quizzer ${i + 1}`)
      }
      expect(quizzers[4]!.name).toBe('')
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
    expect(qzrs[2]!.name).toBe('Quizzer 3')
  })
})
