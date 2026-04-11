import { describe, it, expect } from 'vitest'
import { createQuizStore } from '../quizStore'
import { CellValue, buildColumns, buildKeyToIdx } from '../../types/scoresheet'
import { toQuizzerId } from '../../types/indices'

const COLUMNS = buildColumns()
const KEY_TO_IDX = buildKeyToIdx(COLUMNS)

const C = CellValue.Correct
const E = CellValue.Error
const F = CellValue.Foul
const B = CellValue.Bonus
const _ = CellValue.Empty

function ci(key: string): number {
  const idx = KEY_TO_IDX.get(key)
  if (idx === undefined) throw new Error(`Column ${key} not found`)
  return idx
}

describe('quizStore', () => {
  // --- Initialization ---

  it('creates a store with default quiz, 3 teams, 5 quizzers each', () => {
    const store = createQuizStore()
    expect(store.quiz.id).toBeDefined()
    expect(store.teams).toHaveLength(3)
    for (const team of store.teams) {
      const quizzers = store.quizzersByTeam(team.id)
      expect(quizzers).toHaveLength(5)
    }
  })

  it('teams have sequential seat orders', () => {
    const store = createQuizStore()
    expect(store.teams.map((t) => t.seatOrder)).toEqual([0, 1, 2])
  })

  it('quizzers have sequential seat orders within each team', () => {
    const store = createQuizStore()
    for (const team of store.teams) {
      const quizzers = store.quizzersByTeam(team.id)
      expect(quizzers.map((q) => q.seatOrder)).toEqual([0, 1, 2, 3, 4])
    }
  })

  it('starts with no answers', () => {
    const store = createQuizStore()
    expect(store.answers).toHaveLength(0)
  })

  // --- Setting and getting answers ---

  it('setAnswer adds an answer', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setAnswer(qzr.id, '1', C)
    expect(store.answers).toHaveLength(1)
    expect(store.getAnswer(qzr.id, '1')).toBe(C)
  })

  it('setAnswer overwrites an existing answer', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setAnswer(qzr.id, '1', C)
    store.setAnswer(qzr.id, '1', E)
    expect(store.answers).toHaveLength(1)
    expect(store.getAnswer(qzr.id, '1')).toBe(E)
  })

  it('setAnswer with Empty removes the answer', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setAnswer(qzr.id, '1', C)
    store.setAnswer(qzr.id, '1', _)
    expect(store.answers).toHaveLength(0)
    expect(store.getAnswer(qzr.id, '1')).toBe(_)
  })

  it('getAnswer returns Empty for nonexistent answer', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    expect(store.getAnswer(qzr.id, '1')).toBe(_)
  })

  it('multiple answers on different columns', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setAnswer(qzr.id, '1', C)
    store.setAnswer(qzr.id, '3', E)
    store.setAnswer(qzr.id, '17B', B)
    expect(store.answers).toHaveLength(3)
    expect(store.getAnswer(qzr.id, '1')).toBe(C)
    expect(store.getAnswer(qzr.id, '3')).toBe(E)
    expect(store.getAnswer(qzr.id, '17B')).toBe(B)
  })

  it('multiple quizzers can have answers on different columns', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    const qzrs = store.quizzersByTeam(team.id)
    store.setAnswer(qzrs[0]!.id, '1', C)
    store.setAnswer(qzrs[1]!.id, '2', E)
    expect(store.answers).toHaveLength(2)
    expect(store.getAnswer(qzrs[0]!.id, '1')).toBe(C)
    expect(store.getAnswer(qzrs[1]!.id, '2')).toBe(E)
  })

  // --- Cell grid derivation ---

  it('cellGrid returns a 3D array indexed by [teamIdx][quizzerIdx][colIdx]', () => {
    const store = createQuizStore()
    const grid = store.cellGrid(COLUMNS)
    expect(grid).toHaveLength(3)
    for (const teamCells of grid) {
      expect(teamCells).toHaveLength(5)
      for (const row of teamCells) {
        expect(row).toHaveLength(COLUMNS.length)
        expect(row.every((v) => v === _)).toBe(true)
      }
    }
  })

  it('cellGrid reflects answers at the correct positions', () => {
    const store = createQuizStore()
    const team0 = store.teams[0]!
    const team1 = store.teams[1]!
    const qzrs0 = store.quizzersByTeam(team0.id)
    const qzrs1 = store.quizzersByTeam(team1.id)

    store.setAnswer(qzrs0[0]!.id, '1', C)
    store.setAnswer(qzrs0[2]!.id, '5', F)
    store.setAnswer(qzrs1[1]!.id, '17B', B)

    const grid = store.cellGrid(COLUMNS)
    expect(grid[0]![0]![ci('1')]).toBe(C)
    expect(grid[0]![2]![ci('5')]).toBe(F)
    expect(grid[1]![1]![ci('17B')]).toBe(B)

    // Everything else empty
    expect(grid[0]![0]![ci('2')]).toBe(_)
    expect(grid[2]![0]![ci('1')]).toBe(_)
  })

  it('cellGrid updates when an answer is changed', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setAnswer(qzr.id, '1', C)
    expect(store.cellGrid(COLUMNS)[0]![0]![ci('1')]).toBe(C)

    store.setAnswer(qzr.id, '1', E)
    expect(store.cellGrid(COLUMNS)[0]![0]![ci('1')]).toBe(E)
  })

  it('cellGrid updates when an answer is removed', () => {
    const store = createQuizStore()
    const qzr = store.quizzersByTeam(store.teams[0]!.id)[0]!
    store.setAnswer(qzr.id, '1', C)
    store.setAnswer(qzr.id, '1', _)
    expect(store.cellGrid(COLUMNS)[0]![0]![ci('1')]).toBe(_)
  })

  it('cellGrid respects team seat order', () => {
    const store = createQuizStore()
    // Team at seatOrder 0 should be grid index 0
    const team0 = store.teams.find((t) => t.seatOrder === 0)!
    const team2 = store.teams.find((t) => t.seatOrder === 2)!
    const qzr0 = store.quizzersByTeam(team0.id)[0]!
    const qzr2 = store.quizzersByTeam(team2.id)[0]!

    store.setAnswer(qzr0.id, '1', C)
    store.setAnswer(qzr2.id, '1', E)

    const grid = store.cellGrid(COLUMNS)
    expect(grid[0]![0]![ci('1')]).toBe(C)
    expect(grid[2]![0]![ci('1')]).toBe(E)
  })

  it('cellGrid respects quizzer seat order within a team', () => {
    const store = createQuizStore()
    const team = store.teams[0]!
    const qzrs = store.quizzersByTeam(team.id)
    // quizzer at seatOrder 0 should be row 0, seatOrder 4 should be row 4
    store.setAnswer(qzrs[0]!.id, '1', C)
    store.setAnswer(qzrs[4]!.id, '2', E)

    const grid = store.cellGrid(COLUMNS)
    expect(grid[0]![0]![ci('1')]).toBe(C)
    expect(grid[0]![4]![ci('2')]).toBe(E)
  })

  // --- Quiz metadata ---

  it('quiz has default values', () => {
    const store = createQuizStore()
    expect(store.quiz.division).toBe('1')
    expect(store.quiz.quizNumber).toBe('1')
    expect(store.quiz.overtime).toBe(false)
  })

  // --- quizzersByTeam ---

  it('quizzersByTeam returns quizzers sorted by seatOrder', () => {
    const store = createQuizStore()
    for (const team of store.teams) {
      const qzrs = store.quizzersByTeam(team.id)
      for (let i = 1; i < qzrs.length; i++) {
        expect(qzrs[i]!.seatOrder).toBeGreaterThan(qzrs[i - 1]!.seatOrder)
      }
    }
  })

  it('quizzersByTeam returns empty array for unknown team', () => {
    const store = createQuizStore()
    expect(store.quizzersByTeam(999)).toEqual([])
  })

  // --- teamForQuizzer ---

  it('teamForQuizzer returns the correct team', () => {
    const store = createQuizStore()
    const team = store.teams[1]!
    const qzr = store.quizzersByTeam(team.id)[2]!
    expect(store.teamForQuizzer(qzr.id)).toBe(team.id)
  })

  it('teamForQuizzer returns undefined for unknown quizzer', () => {
    const store = createQuizStore()
    expect(store.teamForQuizzer(toQuizzerId(999))).toBeUndefined()
  })
})
