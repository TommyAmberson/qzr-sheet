import { describe, it, expect } from 'vitest'
import { CellValue, buildColumns } from '../../types/scoresheet'
import { overtimeQuestionsNeeded } from '../overtime'

const columns = buildColumns()
const C = CellValue.Correct
const E = CellValue.Error
const F = CellValue.Foul
const B = CellValue.Bonus
const MB = CellValue.MissedBonus
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

/** Fill questions 1-15 with correct answers for team 0, quizzer 0-3 (4 quizzers rotate) */
function fillRegulation(cells: CellValue[][][], noJumps: boolean[]) {
  // Q1-15: team 0 quizzer (i % 4) gets correct
  for (let q = 1; q <= 15; q++) {
    const qi = (q - 1) % 4
    cells[0]![qi]![ci(`${q}`)] = C
  }
  // Q16-20: need to fill these too
  for (let q = 16; q <= 20; q++) {
    const qi = (q - 1) % 4
    cells[0]![qi]![ci(`${q}`)] = C
  }
}

function blankNoJumps(): boolean[] {
  return columns.map(() => false)
}

describe('overtimeQuestionsNeeded', () => {
  it('returns 0 when overtime is not checked', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    // Teams tied at same score but overtime not enabled
    const teamScores = [100, 100, 50]
    const result = overtimeQuestionsNeeded(false, cells, columns, noJumps, teamScores)
    expect(result).toBe(0)
  })

  it('returns 0 when regulation is not complete', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    // Only fill some questions, not all
    cells[0]![0]![ci('1')] = C
    cells[0]![1]![ci('2')] = C
    const teamScores = [40, 40, 0]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(0)
  })

  it('returns 0 when regulation is complete but no teams are tied', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    const teamScores = [100, 60, 20]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(0)
  })

  it('returns 3 when regulation complete and two teams tied', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    const teamScores = [100, 100, 20]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(3)
  })

  it('returns 3 when regulation complete and all three teams tied', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    const teamScores = [60, 60, 60]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(3)
  })

  it('returns 3 when first OT round not yet complete', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    // Q21 answered, Q22-23 not yet
    cells[1]![0]![ci('21')] = C
    const teamScores = [100, 120, 20]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(3)
  })

  it('returns 3 when first OT round complete and tie is broken', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    cells[1]![0]![ci('21')] = C
    cells[1]![1]![ci('22')] = C
    cells[1]![2]![ci('23')] = C
    // Tie broken — first round stays visible since it has content
    const teamScores = [100, 160, 20]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(3)
  })

  it('returns 3 when tie broken mid-round (OT has content)', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    // One OT answer breaks the tie, but round stays visible
    cells[1]![0]![ci('21')] = C
    const teamScores = [100, 120, 20]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(3)
  })

  it('returns 6 when first OT round complete and still tied', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    cells[0]![0]![ci('21')] = C
    cells[1]![0]![ci('22')] = C
    cells[2]![0]![ci('23')] = C
    // All three answered one each — still tied
    const teamScores = [120, 120, 120]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(6)
  })

  it('handles no-jump on regulation question — still counts as complete', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    // Clear Q15 answer but mark it no-jump
    cells[0]![2]![ci('15')] = _
    noJumps[ci('15')] = true
    const teamScores = [80, 80, 20]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(3)
  })

  it('handles no-jump on OT question — counts as complete for that round', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    cells[0]![0]![ci('21')] = C
    cells[1]![0]![ci('22')] = C
    noJumps[ci('23')] = true
    // First OT round complete (Q23 is no-jump), still tied
    const teamScores = [120, 120, 100]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(6)
  })

  it('A/B sub-questions count — regulation not complete if A needed but unanswered', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    // Change Q17 from correct to error — now 17A is needed
    cells[0]![0]![ci('17')] = E
    const teamScores = [80, 80, 20]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    // Q17A is needed but unanswered — regulation not complete
    expect(result).toBe(0)
  })

  it('A/B sub-questions answered — regulation complete', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    // Q17 error, Q17A correct — regulation complete
    cells[0]![0]![ci('17')] = E
    cells[1]![0]![ci('17A')] = C
    const teamScores = [80, 80, 20]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(3)
  })

  it('returns 6 when second OT round not yet complete and still tied', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    fillRegulation(cells, noJumps)
    // First OT round
    cells[0]![0]![ci('21')] = C
    cells[1]![0]![ci('22')] = C
    cells[2]![0]![ci('23')] = C
    // Second OT round partially answered
    cells[0]![1]![ci('24')] = C
    const teamScores = [140, 120, 120]
    const result = overtimeQuestionsNeeded(true, cells, columns, noJumps, teamScores)
    expect(result).toBe(6)
  })
})
