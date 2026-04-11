import { describe, it, expect } from 'vitest'
import { createQuizStore } from '../quizStore'
import { CellValue, buildColumns } from '../../types/scoresheet'
import { toSeatIdx as S } from '../../types/indices'

const C = CellValue.Correct
const E = CellValue.Error
const _ = CellValue.Empty

describe('moveQuizzer', () => {
  it('swaps seatOrder of two quizzers', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    const before = store.quizzersByTeam(team.id).map((q) => q.name)
    expect(before).toEqual(['Quizzer 1', 'Quizzer 2', 'Quizzer 3', 'Quizzer 4', ''])

    store.moveQuizzer(team.id, S(0), S(2))
    const after = store.quizzersByTeam(team.id).map((q) => q.name)
    expect(after).toEqual(['Quizzer 3', 'Quizzer 2', 'Quizzer 1', 'Quizzer 4', ''])
  })

  it('answers follow the quizzer after reorder', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    const qzrs = store.quizzersByTeam(team.id)
    // Quizzer 1 (seat 0) gets a correct on Q1
    store.setAnswer(qzrs[0]!.id, '1', C)
    // Quizzer 3 (seat 2) gets an error on Q2
    store.setAnswer(qzrs[2]!.id, '2', E)

    const cols = buildColumns()
    const gridBefore = store.cellGrid(cols)
    expect(gridBefore[0]![0]![0]).toBe(C) // seat 0 = Quizzer 1
    expect(gridBefore[0]![2]![1]).toBe(E) // seat 2 = Quizzer 3

    // Move Quizzer 1 from seat 0 to seat 2
    store.moveQuizzer(team.id, S(0), S(2))

    const gridAfter = store.cellGrid(cols)
    // Quizzer 1 is now at seat 2, answers follow
    expect(gridAfter[0]![2]![0]).toBe(C)
    // Quizzer 3 is now at seat 0 (swapped)
    expect(gridAfter[0]![0]![1]).toBe(E)
  })

  it('no-op when fromSeat equals toSeat', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    store.moveQuizzer(team.id, S(1), S(1))
    const names = store.quizzersByTeam(team.id).map((q) => q.name)
    expect(names).toEqual(['Quizzer 1', 'Quizzer 2', 'Quizzer 3', 'Quizzer 4', ''])
  })

  it('no-op for unknown team', () => {
    const store = createQuizStore()
    // Should not throw
    store.moveQuizzer(999, S(0), S(1))
  })

  it('no-op for out-of-range seats', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    store.moveQuizzer(team.id, S(0), S(10))
    const names = store.quizzersByTeam(team.id).map((q) => q.name)
    expect(names).toEqual(['Quizzer 1', 'Quizzer 2', 'Quizzer 3', 'Quizzer 4', ''])
  })

  it('move last to first', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    store.moveQuizzer(team.id, S(4), S(0))
    const names = store.quizzersByTeam(team.id).map((q) => q.name)
    expect(names).toEqual(['', 'Quizzer 2', 'Quizzer 3', 'Quizzer 4', 'Quizzer 1'])
  })

  it('move first to last', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    store.moveQuizzer(team.id, S(0), S(4))
    const names = store.quizzersByTeam(team.id).map((q) => q.name)
    expect(names).toEqual(['', 'Quizzer 2', 'Quizzer 3', 'Quizzer 4', 'Quizzer 1'])
  })

  it('does not affect other teams', () => {
    const store = createQuizStore()
    const team0 = store.teams[0]!
    const team1 = store.teams[1]!
    store.moveQuizzer(team0.id, S(0), S(2))
    const team1Names = store.quizzersByTeam(team1.id).map((q) => q.name)
    expect(team1Names).toEqual(['Quizzer 1', 'Quizzer 2', 'Quizzer 3', 'Quizzer 4', ''])
  })

  it('multiple moves compose correctly', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    // Move seat 0 → 1 (swap Q1, Q2), then seat 2 → 0 (swap Q3, Q2)
    store.moveQuizzer(team.id, S(0), S(1))
    // After: [Q2, Q1, Q3, Q4, '']
    store.moveQuizzer(team.id, S(2), S(0))
    // After: [Q3, Q1, Q2, Q4, '']
    const names = store.quizzersByTeam(team.id).map((q) => q.name)
    expect(names).toEqual(['Quizzer 3', 'Quizzer 1', 'Quizzer 2', 'Quizzer 4', ''])
  })

  it('adjacent swap (move down one)', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    store.moveQuizzer(team.id, S(1), S(2))
    const names = store.quizzersByTeam(team.id).map((q) => q.name)
    expect(names).toEqual(['Quizzer 1', 'Quizzer 3', 'Quizzer 2', 'Quizzer 4', ''])
  })

  it('adjacent swap (move up one)', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    store.moveQuizzer(team.id, S(2), S(1))
    const names = store.quizzersByTeam(team.id).map((q) => q.name)
    expect(names).toEqual(['Quizzer 1', 'Quizzer 3', 'Quizzer 2', 'Quizzer 4', ''])
  })
})
