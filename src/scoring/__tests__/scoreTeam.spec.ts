import { describe, it, expect } from 'vitest'
import { scoreTeam } from '../scoreTeam'
import { CellValue, buildColumns } from '../../types/scoresheet'

const columns = buildColumns()
const C = CellValue.Correct
const E = CellValue.Error
const F = CellValue.Foul
const B = CellValue.Bonus
const MB = CellValue.MissedBonus
const _ = CellValue.Empty

/** Helper: create a blank 5-quizzer grid */
function blankCells(): CellValue[][] {
  return Array.from({ length: 5 }, () => columns.map(() => _))
}

/** Helper: find column index by key */
function colIdx(key: string): number {
  const idx = columns.findIndex((c) => c.key === key)
  if (idx === -1) throw new Error(`Column ${key} not found`)
  return idx
}

describe('scoreTeam', () => {
  it('scores on-time bonus of +20', () => {
    const cells = blankCells()
    const result = scoreTeam(cells, columns, true)
    expect(result.total).toBe(20)
    expect(result.onTimeBonus).toBe(20)
  })

  it('no on-time bonus when not on time', () => {
    const cells = blankCells()
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(0)
    expect(result.onTimeBonus).toBe(0)
  })

  it('scores +20 for a correct answer', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(20)
  })

  it('scores +10 for 3rd unique quizzer correct', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C // quizzer 1
    cells[1]![colIdx('2')] = C // quizzer 2
    cells[2]![colIdx('3')] = C // quizzer 3 → +10 bonus
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(70) // 20+20+20+10
    expect(result.uniqueCorrectQuizzers).toBe(3)
  })

  it('scores +10 for 4th and 5th unique quizzer correct', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[1]![colIdx('2')] = C
    cells[2]![colIdx('3')] = C // +10
    cells[3]![colIdx('4')] = C // +10
    cells[4]![colIdx('5')] = C // +10
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(130) // 5×20 + 3×10
  })

  it('does not give extra unique-quizzer bonus for same quizzer answering twice', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[1]![colIdx('2')] = C
    cells[2]![colIdx('3')] = C // +10
    cells[0]![colIdx('4')] = C // quizzer 1 again, no new bonus
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(90) // 4×20 + 1×10
  })

  it('no deduction for 1st quizzer error before Q17', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(0)
  })

  it('deducts -10 for 2nd individual error before Q17', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E // 1st error: no deduction
    cells[0]![colIdx('2')] = E // 2nd error: -10
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(-10)
  })

  it('deducts -10 for 3rd team error even if quizzer 1st error', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E // team 1st, quizzer 1st: no deduct
    cells[1]![colIdx('2')] = E // team 2nd, quizzer 1st: no deduct
    cells[2]![colIdx('3')] = E // team 3rd, quizzer 1st: -10
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(-10)
  })

  it('always deducts -10 for errors on Q17+ (isErrorPoints)', () => {
    const cells = blankCells()
    cells[0]![colIdx('17')] = E // 1st error but Q17+: -10
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(-10)
  })

  it('does not deduct for errors on Q16 (not isErrorPoints)', () => {
    const cells = blankCells()
    cells[0]![colIdx('16')] = E
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(0)
  })

  it('deducts -10 every 3 team fouls', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = F
    cells[0]![colIdx('2')] = F
    cells[0]![colIdx('3')] = F // 3rd foul: -10
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(-10)
  })

  it('deducts -10 for 3rd individual foul (foul-out) even if not 3rd team foul', () => {
    const cells = blankCells()
    cells[1]![colIdx('1')] = F // quizzer 2, team foul 1, quizzer 1 individual 0
    cells[0]![colIdx('2')] = F // quizzer 1, team foul 2, quizzer 1 individual 1
    cells[0]![colIdx('3')] = F // quizzer 1, team foul 3, quizzer 1 individual 2 → team -10
    cells[0]![colIdx('4')] = F // quizzer 1, team foul 4, quizzer 1 individual 3 → foul-out -10
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(-20) // -10 for 3rd team + -10 for foul-out
  })

  it('3rd individual foul deduction does not stack with 3rd team foul deduction', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = F // quizzer 1, team foul 1, individual 1
    cells[0]![colIdx('2')] = F // quizzer 1, team foul 2, individual 2
    cells[0]![colIdx('3')] = F // quizzer 1, team foul 3, individual 3 → both 3rd team and foul-out
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(-10) // only -10, not -20
  })

  it('deducts -10 from individual quizzer points on foul-out (3rd foul)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C // +20
    cells[0]![colIdx('2')] = F // foul 1
    cells[0]![colIdx('3')] = F // foul 2
    cells[0]![colIdx('4')] = F // foul 3 → foul-out
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.points).toBe(10) // 20 - 10 = 10
    expect(result.quizzers[0]!.fouledOut).toBe(true)
  })

  it('scores bonus before Q17 as +20', () => {
    const cells = blankCells()
    cells[0]![colIdx('16B')] = B
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(20)
  })

  it('scores bonus Q17+ as +10', () => {
    const cells = blankCells()
    cells[0]![colIdx('17B')] = B
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(10)
  })

  it('scores missed bonus as 0', () => {
    const cells = blankCells()
    cells[0]![colIdx('17B')] = MB
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(0)
  })

  it('awards quizout bonus (+10) for 4 correct with 0 errors', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[0]![colIdx('2')] = C
    cells[0]![colIdx('3')] = C
    cells[0]![colIdx('4')] = C
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(90) // 4×20 + 10 quizout
    expect(result.quizzers[0]!.quizzedOut).toBe(true)
    expect(result.quizzers[0]!.quizoutBonus).toBe(true)
  })

  it('no quizout bonus if quizzer has errors', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[0]![colIdx('2')] = E // error (1st individual, no deduct)
    cells[0]![colIdx('3')] = C
    cells[0]![colIdx('4')] = C
    cells[0]![colIdx('5')] = C // 4th correct = quiz-out, but has error → no bonus
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(80) // 4×20 + 0 (no quizout bonus)
    expect(result.quizzers[0]!.quizzedOut).toBe(true)
    expect(result.quizzers[0]!.quizoutBonus).toBe(false)
  })

  it('2 errors + 1 foul is NOT error out (errors and fouls tracked separately)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    cells[0]![colIdx('2')] = F
    cells[0]![colIdx('3')] = E
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.erroredOut).toBe(false)
    expect(result.quizzers[0]!.fouledOut).toBe(false)
    expect(result.quizzers[0]!.outAfterCol).toBe(-1)
  })

  it('3 errors = error out (no fouls needed)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    cells[0]![colIdx('2')] = E
    cells[0]![colIdx('3')] = E
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.erroredOut).toBe(true)
    expect(result.quizzers[0]!.fouledOut).toBe(false)
  })

  it('detects foul out (3 fouls, 0 errors)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = F
    cells[0]![colIdx('2')] = F
    cells[0]![colIdx('3')] = F
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.erroredOut).toBe(false)
    expect(result.quizzers[0]!.fouledOut).toBe(true)
  })

  it('1 error + 2 fouls is NOT out (errors and fouls tracked separately)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    cells[0]![colIdx('2')] = F
    cells[0]![colIdx('3')] = F
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.erroredOut).toBe(false)
    expect(result.quizzers[0]!.fouledOut).toBe(false)
    expect(result.quizzers[0]!.outAfterCol).toBe(-1)
  })

  it('tracks correct count per quizzer', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[0]![colIdx('3')] = C
    cells[0]![colIdx('5')] = C
    cells[1]![colIdx('2')] = C
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.correctCount).toBe(3)
    expect(result.quizzers[1]!.correctCount).toBe(1)
    expect(result.quizzers[2]!.correctCount).toBe(0)
  })

  it('tracks error count per quizzer', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    cells[0]![colIdx('3')] = E
    cells[1]![colIdx('2')] = E
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.errorCount).toBe(2)
    expect(result.quizzers[1]!.errorCount).toBe(1)
  })

  it('tracks foul count per quizzer', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = F
    cells[0]![colIdx('2')] = F
    cells[1]![colIdx('3')] = F
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.foulCount).toBe(2)
    expect(result.quizzers[1]!.foulCount).toBe(1)
  })

  it('not quizzed out or errored out with fewer than threshold', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[0]![colIdx('2')] = C
    cells[0]![colIdx('3')] = C // 3 correct, not 4
    cells[1]![colIdx('4')] = E
    cells[1]![colIdx('5')] = E // 2 errors+fouls, not 3
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.quizzedOut).toBe(false)
    expect(result.quizzers[1]!.erroredOut).toBe(false)
  })

  it('outAfterCol is the column index of the 4th correct (quiz-out)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[0]![colIdx('2')] = C
    cells[0]![colIdx('3')] = C
    cells[0]![colIdx('4')] = C // quizzed out here
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.outAfterCol).toBe(colIdx('4'))
  })

  it('outAfterCol is the column index of the 3rd error (error-out)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    cells[0]![colIdx('3')] = E
    cells[0]![colIdx('5')] = E // errored out here
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.outAfterCol).toBe(colIdx('5'))
  })

  it('outAfterCol is the column index of the 3rd foul (foul-out)', () => {
    const cells = blankCells()
    cells[0]![colIdx('2')] = F
    cells[0]![colIdx('4')] = F
    cells[0]![colIdx('6')] = F // fouled out here
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.outAfterCol).toBe(colIdx('6'))
  })

  it('outAfterCol is -1 when quizzer is not out', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[0]![colIdx('2')] = C
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.outAfterCol).toBe(-1)
  })

  it('outAfterCol is set at the 3rd error (not combined with fouls)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    cells[0]![colIdx('2')] = F // foul doesn't count toward error out
    cells[0]![colIdx('3')] = E
    cells[0]![colIdx('7')] = E // 3rd error → out here
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.outAfterCol).toBe(colIdx('7'))
    expect(result.quizzers[0]!.erroredOut).toBe(true)
    expect(result.quizzers[0]!.fouledOut).toBe(false)
  })

  it('running totals are null when unchanged from previous column', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[1]![colIdx('3')] = C
    const result = scoreTeam(cells, columns, false)
    expect(result.runningTotals[colIdx('1')]).toBe(20)
    expect(result.runningTotals[colIdx('2')]).toBeNull()
    expect(result.runningTotals[colIdx('3')]).toBe(40)
  })

  it('running totals include on-time bonus from start', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    const result = scoreTeam(cells, columns, true)
    expect(result.runningTotals[colIdx('1')]).toBe(40) // 20 on-time + 20 correct
  })

  it('quizout bonus appears in running total at the 4th correct column', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C
    cells[0]![colIdx('2')] = C
    cells[0]![colIdx('3')] = C
    cells[0]![colIdx('4')] = C // quizout here: +20 correct + 10 quizout
    const result = scoreTeam(cells, columns, false)
    expect(result.runningTotals[colIdx('4')]).toBe(90) // 4×20 + 10
    expect(result.runningTotals[colIdx('5')]).toBeNull() // unchanged after
  })

  it('first column is null when only on-time bonus (shown in its own cell)', () => {
    const cells = blankCells()
    const result = scoreTeam(cells, columns, true)
    expect(result.runningTotals[colIdx('1')]).toBeNull() // on-time bonus in its own cell
    expect(result.total).toBe(20)
  })

  it('marks foul deduction on 3rd team foul', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = F
    cells[1]![colIdx('2')] = F
    cells[2]![colIdx('3')] = F // 3rd team foul → -10
    const result = scoreTeam(cells, columns, false)
    expect(result.foulDeductCols.has(colIdx('3'))).toBe(true)
    expect(result.foulDeductCols.has(colIdx('1'))).toBe(false)
    expect(result.foulDeductCols.has(colIdx('2'))).toBe(false)
  })

  it('marks foul deduction on foul-out', () => {
    const cells = blankCells()
    cells[1]![colIdx('1')] = F // quizzer 2, team 1 → no deduction
    cells[0]![colIdx('2')] = F // quizzer 1, team 2 → no deduction
    cells[0]![colIdx('3')] = F // quizzer 1, team 3 → -10 (3rd team)
    cells[0]![colIdx('4')] = F // quizzer 1, team 4, individual 3 → -10 (foul-out)
    const result = scoreTeam(cells, columns, false)
    expect(result.foulDeductCols.has(colIdx('3'))).toBe(true)
    expect(result.foulDeductCols.has(colIdx('4'))).toBe(true)
    expect(result.foulDeductCols.has(colIdx('1'))).toBe(false)
    expect(result.foulDeductCols.has(colIdx('2'))).toBe(false)
  })

  it('does not mark foul deduction for non-penalized fouls', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = F // 1st team foul → no deduction
    cells[0]![colIdx('2')] = F // 2nd team foul → no deduction
    const result = scoreTeam(cells, columns, false)
    expect(result.foulDeductCols.has(colIdx('1'))).toBe(false)
    expect(result.foulDeductCols.has(colIdx('2'))).toBe(false)
  })

  it('marks free error for 1st individual error before Q17 with team errors < 3', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E // 1st individual, 1st team, not Q17+ → free
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(0)
    expect(result.freeErrorCols.has(colIdx('1'))).toBe(true)
  })

  it('does not repeat running total on free error column', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = C // +20
    cells[0]![colIdx('2')] = E // free error, score stays at 20
    const result = scoreTeam(cells, columns, false)
    expect(result.runningTotals[colIdx('2')]).toBeNull()
  })

  it('does not mark free error for 2nd individual error', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E // free
    cells[0]![colIdx('2')] = E // 2nd individual → not free
    const result = scoreTeam(cells, columns, false)
    expect(result.freeErrorCols.has(colIdx('1'))).toBe(true)
    expect(result.freeErrorCols.has(colIdx('2'))).toBe(false)
  })

  it('does not mark free error on Q17+', () => {
    const cells = blankCells()
    cells[0]![colIdx('17')] = E // Q17+ always deducts
    const result = scoreTeam(cells, columns, false)
    expect(result.freeErrorCols.has(colIdx('17'))).toBe(false)
  })

  it('does not mark free error for 3rd+ team error', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E // free (1st individual, 1st team)
    cells[1]![colIdx('2')] = E // free (1st individual, 2nd team)
    cells[2]![colIdx('3')] = E // 3rd team → not free
    const result = scoreTeam(cells, columns, false)
    expect(result.freeErrorCols.has(colIdx('1'))).toBe(true)
    expect(result.freeErrorCols.has(colIdx('2'))).toBe(true)
    expect(result.freeErrorCols.has(colIdx('3'))).toBe(false)
  })

  it('error deduction does not stack: 2nd individual + 3rd team = only -10', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E // team 1st, quizzer 1 1st: no deduct
    cells[1]![colIdx('2')] = E // team 2nd, quizzer 2 1st: no deduct
    cells[0]![colIdx('3')] = E // team 3rd + quizzer 1 2nd: -10 (not -20)
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(-10)
  })

  it('no individual points for bonus answers', () => {
    const cells = blankCells()
    cells[0]![colIdx('16B')] = B // bonus before Q17: +20 team
    cells[0]![colIdx('17B')] = B // bonus Q17+: +10 team
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(30) // 20 + 10
    expect(result.quizzers[0]!.points).toBe(0) // no individual credit
  })

  it('no individual points for overtime correct answers', () => {
    const otColumns = buildColumns(1)
    const otCells = Array.from({ length: 5 }, () => otColumns.map(() => _))
    const otColIdx = (key: string) => {
      const idx = otColumns.findIndex((c) => c.key === key)
      if (idx === -1) throw new Error(`Column ${key} not found`)
      return idx
    }
    otCells[0]![otColIdx('21')] = C
    const result = scoreTeam(otCells, otColumns, false)
    expect(result.total).toBe(20) // +20 team points
    expect(result.quizzers[0]!.points).toBe(0) // no individual credit for OT
    expect(result.quizzers[0]!.correctCount).toBe(0) // OT doesn't count
  })

  it('deducts -10 at every 3rd team foul (6th foul)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = F // team 1
    cells[0]![colIdx('2')] = F // team 2
    cells[0]![colIdx('3')] = F // team 3 → -10
    cells[1]![colIdx('4')] = F // team 4
    cells[1]![colIdx('5')] = F // team 5
    cells[1]![colIdx('6')] = F // team 6 → -10
    const result = scoreTeam(cells, columns, false)
    expect(result.total).toBe(-20) // -10 (3rd team foul / q0 foul-out) + -10 (6th team foul / q1 foul-out)
    expect(result.foulDeductCols.has(colIdx('3'))).toBe(true)
    expect(result.foulDeductCols.has(colIdx('6'))).toBe(true)
  })

  it('complex scenario: on-time + 3 quizzers + errors + Q17 bonus', () => {
    const cells = blankCells()
    // On time: +20
    // Q1: quizzer 1 correct: +20
    cells[0]![colIdx('1')] = C
    // Q2: quizzer 2 correct: +20
    cells[1]![colIdx('2')] = C
    // Q3: quizzer 3 correct: +20 + 10 (3rd quizzer)
    cells[2]![colIdx('3')] = C
    // Q4: quizzer 1 error: no deduct (1st individual, 1st team)
    cells[0]![colIdx('4')] = E
    // Q5: quizzer 1 error: -10 (2nd individual)
    cells[0]![colIdx('5')] = E
    // Q17B: quizzer 2 bonus: +10
    cells[1]![colIdx('17B')] = B
    const result = scoreTeam(cells, columns, true)
    // 20 + 20 + 20 + 30 + 0 + (-10) + 10 = 90
    expect(result.total).toBe(90)
  })
})
