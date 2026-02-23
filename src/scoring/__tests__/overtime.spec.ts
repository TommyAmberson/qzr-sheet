import { describe, it, expect } from 'vitest'
import { CellValue, buildColumns } from '../../types/scoresheet'
import { getOvertimeEligibleTeams, computeOvertimeRounds } from '../overtime'

const C = CellValue.Correct
const _ = CellValue.Empty

describe('buildColumns overtime', () => {
  it('builds no OT columns with 0 rounds', () => {
    const cols = buildColumns(0)
    expect(cols.some((c) => c.isOvertime)).toBe(false)
  })

  it('builds 3 OT normal columns for 1 round (Q21–23 with A/B)', () => {
    const cols = buildColumns(1)
    const otNormals = cols.filter((c) => c.isOvertime && c.type === '')
    expect(otNormals.map((c) => c.number)).toEqual([21, 22, 23])
  })

  it('builds 6 OT normal columns for 2 rounds (Q21–26)', () => {
    const cols = buildColumns(2)
    const otNormals = cols.filter((c) => c.isOvertime && c.type === '')
    expect(otNormals.map((c) => c.number)).toEqual([21, 22, 23, 24, 25, 26])
  })

  it('builds 9 OT normal columns for 3 rounds (Q21–29)', () => {
    const cols = buildColumns(3)
    const otNormals = cols.filter((c) => c.isOvertime && c.type === '')
    expect(otNormals.map((c) => c.number)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29])
  })

  it('each OT question has A and B sub-columns', () => {
    const cols = buildColumns(1)
    expect(cols.find((c) => c.key === '21A')).toBeDefined()
    expect(cols.find((c) => c.key === '21B')).toBeDefined()
    expect(cols.find((c) => c.key === '23B')).toBeDefined()
  })

  it('no cap — can build many rounds', () => {
    const cols = buildColumns(10)
    const otNormals = cols.filter((c) => c.isOvertime && c.type === '')
    expect(otNormals).toHaveLength(30)
    expect(otNormals[29]!.number).toBe(50)
  })
})

/** Columns with 2 OT rounds for eligible-team tests */
const columns = buildColumns(2)

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

describe('computeOvertimeRounds', () => {
  const onTimes = [true, true, true]

  /**
   * Helper: build a grid with N OT rounds.
   * Returns cols, blank cells, and a column-index lookup.
   */
  function setup(rounds: number) {
    const cols = buildColumns(rounds)
    const cells = [0, 1, 2].map(() =>
      Array.from({ length: 5 }, () => cols.map(() => _)),
    )
    const idx = (key: string) => {
      const i = cols.findIndex((c) => c.key === key)
      if (i === -1) throw new Error(`Column ${key} not found`)
      return i
    }
    return { cols, cells, idx }
  }

  /**
   * Fill regulation with a 3-way tie: each team gets 5 corrects, rest no-jumped.
   * Each team: 20 on-time + 5×20 = 120 pts.
   */
  function fillRegulationTiedSimple(
    cells: CellValue[][][],
    idx: (k: string) => number,
    noJumps: boolean[],
  ) {
    // 5 corrects per team → each team: 20 on-time + 5*20 = 120
    const team0Qs = ['1', '4', '7', '10', '13']
    const team1Qs = ['2', '5', '8', '11', '14']
    const team2Qs = ['3', '6', '9', '12', '15']
    for (const q of team0Qs) cells[0]![0]![idx(q)] = C
    for (const q of team1Qs) cells[1]![0]![idx(q)] = C
    for (const q of team2Qs) cells[2]![0]![idx(q)] = C
    // Mark remaining regulation normal columns as no-jump
    for (let n = 16; n <= 20; n++) noJumps[idx(`${n}`)] = true
  }

  it('returns 0 when regulation is not completely filled out', () => {
    const { cols, cells } = setup(2)
    const noJumps = cols.map(() => false)
    // Only a couple answers — regulation incomplete
    cells[0]![0]![0] = C
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(0)
  })

  it('returns 0 when regulation is complete but no teams are tied', () => {
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    // Team 0 gets more corrects than others
    cells[0]![0]![idx('1')] = C
    cells[0]![1]![idx('2')] = C
    cells[0]![2]![idx('3')] = C
    cells[1]![0]![idx('4')] = C
    cells[2]![0]![idx('5')] = C
    // No-jump the rest
    for (let n = 6; n <= 20; n++) noJumps[idx(`${n}`)] = true
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(0)
  })

  it('returns 1 when regulation is complete and teams are tied', () => {
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(1)
  })

  it('returns 2 when OT round 1 is complete and still tied', () => {
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)
    // Fill OT round 1 — each eligible team gets 1 correct → still tied
    cells[0]![0]![idx('21')] = C
    cells[1]![0]![idx('22')] = C
    cells[2]![0]![idx('23')] = C
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(2)
  })

  it('returns 1 when OT round 1 is complete and tie is broken', () => {
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)
    // Only team 0 gets a correct in OT → tie broken
    cells[0]![0]![idx('21')] = C
    noJumps[idx('22')] = true
    noJumps[idx('23')] = true
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(1)
  })

  it('returns 1 when OT round 1 is partially filled (not complete yet)', () => {
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)
    // Only 1 of 3 OT questions answered
    cells[0]![0]![idx('21')] = C
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(1)
  })
})
