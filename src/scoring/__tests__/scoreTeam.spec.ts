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
    cells[0]![colIdx('2')] = E // error
    cells[0]![colIdx('3')] = C
    cells[0]![colIdx('4')] = C
    cells[0]![colIdx('5')] = C
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.quizzedOut).toBe(true)
    expect(result.quizzers[0]!.quizoutBonus).toBe(false)
  })

  it('detects error out (3 errors)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    cells[0]![colIdx('2')] = E
    cells[0]![colIdx('3')] = E
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.erroredOut).toBe(true)
  })

  it('detects error out with mix of errors and fouls', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    cells[0]![colIdx('2')] = F
    cells[0]![colIdx('3')] = E
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.erroredOut).toBe(true)
  })

  it('detects foul out (3 fouls, 0 errors)', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = F
    cells[0]![colIdx('2')] = F
    cells[0]![colIdx('3')] = F
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.erroredOut).toBe(true)
    expect(result.quizzers[0]!.fouledOut).toBe(true)
  })

  it('fouledOut is false when errors contribute to out', () => {
    const cells = blankCells()
    cells[0]![colIdx('1')] = E
    cells[0]![colIdx('2')] = F
    cells[0]![colIdx('3')] = F
    const result = scoreTeam(cells, columns, false)
    expect(result.quizzers[0]!.erroredOut).toBe(true)
    expect(result.quizzers[0]!.fouledOut).toBe(false)
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

  it('first column always shows running total', () => {
    const cells = blankCells()
    const result = scoreTeam(cells, columns, true)
    expect(result.runningTotals[colIdx('1')]).toBe(20) // on-time bonus visible
    expect(result.total).toBe(20)
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
