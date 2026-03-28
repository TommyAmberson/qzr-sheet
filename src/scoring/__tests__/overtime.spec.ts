import { describe, it, expect } from 'vitest'
import { CellValue, buildColumns } from '../../types/scoresheet'
import {
  getOvertimeEligibleTeams,
  computeOvertimeRounds,
  computeRegulationScores,
  computeOtCheckpointScores,
  questionsComplete,
  quizJumpedComplete,
} from '../overtime'

const C = CellValue.Correct
const E = CellValue.Error
const F = CellValue.Foul
const B = CellValue.Bonus
const MB = CellValue.MissedBonus
const _ = CellValue.Empty

describe('questionsComplete', () => {
  function setup() {
    const cols = buildColumns(0)
    const cells = [0, 1, 2].map(() => Array.from({ length: 5 }, () => cols.map(() => _)))
    const idx = (key: string) => {
      const i = cols.findIndex((c) => c.key === key)
      if (i === -1) throw new Error(`Column ${key} not found`)
      return i
    }
    const noJumps = cols.map(() => false)
    return { cols, cells, idx, noJumps }
  }

  it('returns false when regulation is not filled out at all', () => {
    const { cols, cells, noJumps } = setup()
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(false)
  })

  it('returns true when all questions are no-jumped', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 20; n++) noJumps[idx(`${n}`)] = true
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(true)
  })

  it('returns true for a Q1-15 correct answer', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 20; n++) noJumps[idx(`${n}`)] = true
    noJumps[idx('1')] = false
    cells[0]![0]![idx('1')] = C
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(true)
  })

  it('returns true for a Q1-15 error (question moved on via toss-up)', () => {
    const { cols, cells, idx, noJumps } = setup()
    cells[0]![0]![idx('1')] = E
    for (let n = 2; n <= 20; n++) noJumps[idx(`${n}`)] = true
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(true)
  })

  it('returns true when Q16 normal is answered correctly (no sub-columns needed)', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = C
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(true)
  })

  it('returns false when Q16 normal has only a foul (not jumped)', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = F
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(false)
  })

  it('returns false when Q16 normal errors and Q16A has only a foul', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = E
    cells[1]![0]![idx('16A')] = F
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(false)
  })

  it('returns true when Q16 normal errors and Q16A is correct', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = E
    cells[1]![0]![idx('16A')] = C
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(true)
  })

  it('returns true when Q16 normal errors, Q16A errors, Q16B is MB', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = E
    cells[1]![0]![idx('16A')] = E
    cells[2]![0]![idx('16B')] = MB
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(true)
  })

  it('returns true when Q20 normal errors and Q20A is no-jumped', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 19; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('20')] = E
    noJumps[idx('20A')] = true
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(true)
  })

  it('returns true when Q20 normal errors, Q20A errors, Q20B is no-jumped', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 19; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('20')] = E
    cells[1]![0]![idx('20A')] = E
    noJumps[idx('20B')] = true
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(true)
  })

  it('returns false when Q16 normal errors, Q16A errors, Q16B has only a foul', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = E
    cells[1]![0]![idx('16A')] = E
    cells[2]![0]![idx('16B')] = F
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(false)
  })

  it('returns false when Q16 normal errors and sub-columns are empty', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = E
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(false)
  })

  it('returns false when Q16 normal errors, Q16A errors, Q16B is empty', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = E
    cells[1]![0]![idx('16A')] = E
    expect(questionsComplete(cells, cols, noJumps, 1, 20)).toBe(false)
  })
})

describe('quizJumpedComplete', () => {
  function setup() {
    const cols = buildColumns(1) // 1 OT round allocated
    const cells = [0, 1, 2].map(() => Array.from({ length: 5 }, () => cols.map(() => _)))
    const idx = (key: string) => {
      const i = cols.findIndex((c) => c.key === key)
      if (i === -1) throw new Error(`Column ${key} not found`)
      return i
    }
    const noJumps = cols.map(() => false)
    return { cols, cells, idx, noJumps }
  }

  it('returns false when no questions answered', () => {
    const { cols, cells, noJumps } = setup()
    expect(quizJumpedComplete(cells, cols, noJumps, 0)).toBe(false)
  })

  it('returns true when all normal questions no-jumped', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 20; n++) noJumps[idx(`${n}`)] = true
    expect(quizJumpedComplete(cells, cols, noJumps, 0)).toBe(true)
  })

  it('returns true when errors count as jumped on', () => {
    const { cols, cells, idx, noJumps } = setup()
    // Q1 error, Q2–20 no-jumped
    cells[0]![0]![idx('1')] = E
    for (let n = 2; n <= 20; n++) noJumps[idx(`${n}`)] = true
    expect(quizJumpedComplete(cells, cols, noJumps, 0)).toBe(true)
  })

  it('returns true when fouls do not count but the question was still answered', () => {
    const { cols, cells, idx, noJumps } = setup()
    // Q1: foul (doesn\'t count) + correct = jumped
    cells[0]![0]![idx('1')] = F
    cells[1]![0]![idx('1')] = C
    for (let n = 2; n <= 20; n++) noJumps[idx(`${n}`)] = true
    expect(quizJumpedComplete(cells, cols, noJumps, 0)).toBe(true)
  })

  it('returns false when Q1 has only a foul (not jumped)', () => {
    const { cols, cells, idx, noJumps } = setup()
    cells[0]![0]![idx('1')] = F
    for (let n = 2; n <= 20; n++) noJumps[idx(`${n}`)] = true
    expect(quizJumpedComplete(cells, cols, noJumps, 0)).toBe(false)
  })

  it('returns true when Q16 normal has only errors but Q16A has an answer', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = E
    cells[1]![0]![idx('16A')] = C
    expect(quizJumpedComplete(cells, cols, noJumps, 0)).toBe(true)
  })

  it('returns true when Q16 normal has only errors but Q16B has an answer', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 15; n++) noJumps[idx(`${n}`)] = true
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('16')] = E
    cells[1]![0]![idx('16A')] = E
    cells[2]![0]![idx('16B')] = MB
    expect(quizJumpedComplete(cells, cols, noJumps, 0)).toBe(true)
  })

  it('ignores allocated OT columns when visibleOtRounds is 0', () => {
    const { cols, cells, idx, noJumps } = setup()
    // cols has Q21–23 allocated but visibleOtRounds=0 should ignore them
    for (let n = 1; n <= 20; n++) noJumps[idx(`${n}`)] = true
    expect(quizJumpedComplete(cells, cols, noJumps, 0)).toBe(true)
  })

  it('returns false when OT round is visible but not yet answered', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 20; n++) noJumps[idx(`${n}`)] = true
    // visibleOtRounds=1 means Q21–23 must be answered
    expect(quizJumpedComplete(cells, cols, noJumps, 1)).toBe(false)
  })

  it('returns true when OT round is visible and fully answered', () => {
    const { cols, cells, idx, noJumps } = setup()
    for (let n = 1; n <= 20; n++) noJumps[idx(`${n}`)] = true
    cells[0]![0]![idx('21')] = C
    cells[1]![0]![idx('22')] = C
    cells[2]![0]![idx('23')] = C
    expect(quizJumpedComplete(cells, cols, noJumps, 1)).toBe(true)
  })
})

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
  return [0, 1, 2].map(() => Array.from({ length: 5 }, () => columns.map(() => _)))
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
    const cells = [0, 1, 2].map(() => Array.from({ length: 5 }, () => cols.map(() => _)))
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
    // Team 0: 3 correct = 80, Team 1: 2 correct = 60, Team 2: 1 correct = 40
    cells[0]![0]![idx('1')] = C
    cells[0]![1]![idx('2')] = C
    cells[0]![2]![idx('3')] = C
    cells[1]![0]![idx('4')] = C
    cells[1]![1]![idx('5')] = C
    cells[2]![0]![idx('6')] = C
    // No-jump the rest
    for (let n = 7; n <= 20; n++) noJumps[idx(`${n}`)] = true
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(0)
  })

  it('returns 1 when regulation is complete and teams are tied', () => {
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(1)
  })

  it('returns 1 when regulation has error-only Q1-15 columns and teams are tied', () => {
    // Regression: error-only non-isAB columns must count as complete, not block OT.
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)
    // Un-no-jump Q1 and put an error there — Q1 now has only an error (no correct).
    // questionsComplete must still treat it as done.
    noJumps[idx('1')] = false
    cells[0]![0]![idx('1')] = E
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

  it('returns 1 when OT round 1 fully breaks the tie', () => {
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)
    // Team 0 gets Q21, Team 1 gets Q22, Team 2 gets Q23
    // Each gets +20 → 140 each → still tied... need different point values.
    // Instead: Team 0 gets Q21 (+20) and Q22 (+20), Team 1 gets Q23 (+20)
    // Scores: Team 0: 160, Team 1: 140, Team 2: 120 → all unique
    cells[0]![0]![idx('21')] = C
    cells[0]![1]![idx('22')] = C
    cells[1]![0]![idx('23')] = C
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(1)
  })

  it('returns 2 when OT round 1 only partially breaks a 3-way tie', () => {
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)
    // Only team 0 gets a correct, teams 1 & 2 no-jump
    // Scores: Team 0: 140, Team 1: 120, Team 2: 120 → 1 & 2 still tied
    cells[0]![0]![idx('21')] = C
    noJumps[idx('22')] = true
    noJumps[idx('23')] = true
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(2)
  })

  it('returns 1 when OT round 1 is partially filled (not complete yet)', () => {
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)
    // Only 1 of 3 OT questions answered
    cells[0]![0]![idx('21')] = C
    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(1)
  })

  it('does not trigger another round when a non-eligible team happens to match an eligible team score', () => {
    // Regulation: Team 0 & Team 2 tied, Team 1 ahead (not tied)
    // After OT round 1: Team 1 & Team 2 have the same score,
    // but Team 1 was never in OT — this is NOT a real tie.
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)

    // Team 0: 5 corrects on Q1,4,7,10,13 → 120
    // Team 1: 5 corrects on Q2,5,8,11,14 → 120
    // Team 2: 5 corrects on Q3,6,9,12,15 → 120
    // (start from the 3-way tie helper)
    fillRegulationTiedSimple(cells, idx, noJumps)

    // Now give Team 1 an extra correct to break out of the tie
    // Use Q16 for Team 1 → Team 1: 140, Teams 0 & 2: 120
    cells[1]![1]![idx('16')] = C
    // No-jump remaining regulation
    for (let n = 17; n <= 20; n++) noJumps[idx(`${n}`)] = true

    // OT round 1: Team 2 gets correct on Q21, others no-jump
    // Team 0: 120, Team 1: 140, Team 2: 140
    // Team 1 & 2 now share 140, but Team 1 was never tied —
    // the originally-tied teams (0 & 2) are NO LONGER tied → done
    cells[2]![0]![idx('21')] = C
    noJumps[idx('22')] = true
    noJumps[idx('23')] = true

    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(1)
  })

  it('triggers another round when originally-tied teams are still tied after OT', () => {
    // 3-way regulation tie, OT round 1 breaks one team out but two remain tied
    const { cols, cells, idx } = setup(2)
    const noJumps = cols.map(() => false)
    fillRegulationTiedSimple(cells, idx, noJumps)

    // OT round 1: Teams 0 & 1 each get a correct, Team 2 no-jumped
    // Team 0: 140, Team 1: 140, Team 2: 120 → 0 & 1 still tied
    cells[0]![0]![idx('21')] = C
    cells[1]![0]![idx('22')] = C
    noJumps[idx('23')] = true

    expect(computeOvertimeRounds(cells, cols, onTimes, noJumps)).toBe(2)
  })
})

describe('computeRegulationScores', () => {
  const onTimes = [true, true, true]

  it('returns on-time bonus only for blank sheets', () => {
    const cols = buildColumns()
    const cells = [0, 1, 2].map(() => Array.from({ length: 5 }, () => cols.map(() => _)))
    const scores = computeRegulationScores(cells, cols, onTimes)
    expect(scores).toEqual([20, 20, 20])
  })

  it('computes correct scores per team from regulation columns', () => {
    const cols = buildColumns()
    const cells = [0, 1, 2].map(() => Array.from({ length: 5 }, () => cols.map(() => _)))
    const idx = (key: string) => cols.findIndex((c) => c.key === key)
    cells[0]![0]![idx('1')] = C // team 0: +20
    cells[1]![0]![idx('2')] = C // team 1: +20
    cells[1]![1]![idx('3')] = C // team 1: +20
    const scores = computeRegulationScores(cells, cols, onTimes)
    // on-time (+20) + corrects
    expect(scores[0]).toBe(40) // 20 on-time + 20
    expect(scores[1]).toBe(60) // 20 on-time + 20 + 20
    expect(scores[2]).toBe(20) // 20 on-time only
  })

  it('ignores OT columns when computing regulation scores', () => {
    const cols = buildColumns(1) // has Q21–23
    const cells = [0, 1, 2].map(() => Array.from({ length: 5 }, () => cols.map(() => _)))
    const idx = (key: string) => cols.findIndex((c) => c.key === key)
    cells[0]![0]![idx('1')] = C // regulation: +20
    cells[0]![1]![idx('21')] = C // OT: should be ignored
    const scores = computeRegulationScores(cells, cols, onTimes)
    expect(scores[0]).toBe(40) // 20 on-time + 20 from Q1 only
  })

  it('respects onTime flag per team', () => {
    const cols = buildColumns()
    const cells = [0, 1, 2].map(() => Array.from({ length: 5 }, () => cols.map(() => _)))
    const scores = computeRegulationScores(cells, cols, [true, false, true])
    expect(scores[0]).toBe(20) // on-time
    expect(scores[1]).toBe(0) // not on-time
    expect(scores[2]).toBe(20) // on-time
  })
})

describe('computeOtCheckpointScores', () => {
  const onTimes = [true, true, true]

  function setup(rounds: number) {
    const cols = buildColumns(rounds)
    const cells = [0, 1, 2].map(() => Array.from({ length: 5 }, () => cols.map(() => _)))
    const idx = (key: string) => {
      const i = cols.findIndex((c) => c.key === key)
      if (i === -1) throw new Error(`Column ${key} not found`)
      return i
    }
    const noJumps = cols.map(() => false)
    return { cols, cells, idx, noJumps }
  }

  it('returns empty array when no OT rounds are complete', () => {
    const { cols, cells, noJumps } = setup(1)
    // Q21 not answered
    expect(computeOtCheckpointScores(cells, cols, onTimes, noJumps)).toEqual([])
  })

  it('returns one checkpoint when OT round 1 is complete', () => {
    const { cols, cells, idx, noJumps } = setup(1)
    noJumps[idx('21')] = true
    noJumps[idx('22')] = true
    noJumps[idx('23')] = true
    const checkpoints = computeOtCheckpointScores(cells, cols, onTimes, noJumps)
    expect(checkpoints).toHaveLength(1)
    // All teams: 20 on-time, no answers
    expect(checkpoints[0]).toEqual([20, 20, 20])
  })

  it('checkpoint scores include points up through that OT round', () => {
    const { cols, cells, idx, noJumps } = setup(2)
    // Complete round 1: team 0 gets Q21 correct
    cells[0]![0]![idx('21')] = C
    noJumps[idx('22')] = true
    noJumps[idx('23')] = true
    // Complete round 2: team 1 gets Q24 correct
    cells[1]![0]![idx('24')] = C
    noJumps[idx('25')] = true
    noJumps[idx('26')] = true
    const checkpoints = computeOtCheckpointScores(cells, cols, onTimes, noJumps)
    expect(checkpoints).toHaveLength(2)
    // Round 1 checkpoint: team 0 has 20 on-time + 20 Q21 = 40
    expect(checkpoints[0]![0]).toBe(40)
    expect(checkpoints[0]![1]).toBe(20)
    expect(checkpoints[0]![2]).toBe(20)
    // Round 2 checkpoint: team 0 still 40, team 1 has 20 on-time + 20 Q24 = 40
    expect(checkpoints[1]![0]).toBe(40)
    expect(checkpoints[1]![1]).toBe(40)
    expect(checkpoints[1]![2]).toBe(20)
  })

  it('stops at the first incomplete OT round', () => {
    const { cols, cells, idx, noJumps } = setup(2)
    // Round 1: complete
    noJumps[idx('21')] = true
    noJumps[idx('22')] = true
    noJumps[idx('23')] = true
    // Round 2: incomplete (Q24 not answered)
    const checkpoints = computeOtCheckpointScores(cells, cols, onTimes, noJumps)
    expect(checkpoints).toHaveLength(1)
  })
})
