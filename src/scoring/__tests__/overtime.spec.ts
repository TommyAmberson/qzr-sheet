import { describe, it, expect } from 'vitest'
import { CellValue, buildColumns } from '../../types/scoresheet'
import { overtimeQuestionsNeeded, getOvertimeEligibleTeams } from '../overtime'

const columns = buildColumns()
const C = CellValue.Correct
const _ = CellValue.Empty

/** Find column index by key */
function ci(key: string): number {
  const idx = columns.findIndex((c) => c.key === key)
  if (idx === -1) throw new Error(`Column ${key} not found`)
  return idx
}

/** Helper: blank 3-team, 5-quizzer grid */
function blankCells(): CellValue[][][] {
  return [0, 1, 2].map(() =>
    Array.from({ length: 5 }, () => columns.map(() => _)),
  )
}

describe('overtimeQuestionsNeeded', () => {
  it('returns 0 when overtime is not enabled', () => {
    expect(overtimeQuestionsNeeded(false)).toBe(0)
  })

  it('returns 6 when overtime is enabled', () => {
    expect(overtimeQuestionsNeeded(true)).toBe(6)
  })
})

describe('getOvertimeEligibleTeams', () => {
  const onTimes = [true, true, true]

  it('returns empty set when no teams are tied', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[0]![1]![ci('2')] = C
    cells[1]![0]![ci('3')] = C
    // Team 0: 60, Team 1: 40, Team 2: 20
    const eligible = getOvertimeEligibleTeams(cells, columns, onTimes)
    expect(eligible.size).toBe(0)
  })

  it('returns tied teams when two teams share highest score', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[1]![0]![ci('2')] = C
    // Team 0 and 1: 40 each, Team 2: 20
    const eligible = getOvertimeEligibleTeams(cells, columns, onTimes)
    expect(eligible.has(0)).toBe(true)
    expect(eligible.has(1)).toBe(true)
    expect(eligible.has(2)).toBe(false)
  })

  it('returns all teams when all three tied', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[1]![0]![ci('2')] = C
    cells[2]![0]![ci('3')] = C
    const eligible = getOvertimeEligibleTeams(cells, columns, onTimes)
    expect(eligible.has(0)).toBe(true)
    expect(eligible.has(1)).toBe(true)
    expect(eligible.has(2)).toBe(true)
  })

  it('returns teams tied at lower scores (2nd place tie)', () => {
    const cells = blankCells()
    // Team 0: 80, Teams 1 & 2: 40
    cells[0]![0]![ci('1')] = C
    cells[0]![1]![ci('2')] = C
    cells[0]![2]![ci('3')] = C
    cells[1]![0]![ci('4')] = C
    cells[2]![0]![ci('5')] = C
    const eligible = getOvertimeEligibleTeams(cells, columns, onTimes)
    expect(eligible.has(0)).toBe(false)
    expect(eligible.has(1)).toBe(true)
    expect(eligible.has(2)).toBe(true)
  })

  it('uses regulation-only scores (ignores OT answers)', () => {
    const cells = blankCells()
    // Teams 0 and 1 tied at 40 from regulation
    cells[0]![0]![ci('1')] = C
    cells[1]![0]![ci('2')] = C
    // Team 0 also has an OT answer — should be ignored for eligibility
    cells[0]![1]![ci('21')] = C
    const eligible = getOvertimeEligibleTeams(cells, columns, onTimes)
    // Both should still be eligible (OT answer doesn't affect regulation score)
    expect(eligible.has(0)).toBe(true)
    expect(eligible.has(1)).toBe(true)
  })

  it('respects onTime flag for score computation', () => {
    const cells = blankCells()
    // Team 0: 1 correct (20 pts) + on-time (20) = 40
    // Team 1: 1 correct (20 pts) + no on-time (0) = 20
    cells[0]![0]![ci('1')] = C
    cells[1]![0]![ci('2')] = C
    const eligible = getOvertimeEligibleTeams(cells, columns, [true, false, true])
    // Team 0: 40, Team 1: 20, Team 2: 20 (on-time only)
    // Teams 1 & 2 tied at 20
    expect(eligible.has(0)).toBe(false)
    expect(eligible.has(1)).toBe(true)
    expect(eligible.has(2)).toBe(true)
  })
})
