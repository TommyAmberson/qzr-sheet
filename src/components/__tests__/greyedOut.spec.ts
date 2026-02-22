import { describe, it, expect } from 'vitest'
import { CellValue, buildColumns } from '../../types/scoresheet'
import { computeGreyedOut } from '../../scoring/greyedOut'

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

/** Helper: check if a team is greyed at a column */
function isGreyed(set: Set<string>, ti: number, colIdx: number): boolean {
  return set.has(`${ti}:${colIdx}`)
}

/** Helper: check if a column is a bonus for a team (other 2 teams greyed) */
function isBonusFor(set: Set<string>, ti: number, colIdx: number, teamCount = 3): boolean {
  let greyedTeams = 0
  for (let t = 0; t < teamCount; t++) {
    if (t !== ti && set.has(`${t}:${colIdx}`)) greyedTeams++
  }
  return greyedTeams === teamCount - 1
}

/** Helper: blank 3-team, 5-quizzer grid */
function blankCells(): CellValue[][][] {
  return [0, 1, 2].map(() =>
    Array.from({ length: 5 }, () => columns.map(() => _)),
  )
}

describe('greyed-out logic', () => {
  it('correct answer greys out all teams on that column', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C // team 0, quizzer 0, Q1 correct
    const result = computeGreyedOut(cells, columns)
    expect(isGreyed(result, 0, ci('1'))).toBe(true)
    expect(isGreyed(result, 1, ci('1'))).toBe(true)
    expect(isGreyed(result, 2, ci('1'))).toBe(true)
  })

  it('correct answer does NOT grey the next question', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    const result = computeGreyedOut(cells, columns)
    expect(isGreyed(result, 0, ci('2'))).toBe(false)
    expect(isGreyed(result, 1, ci('2'))).toBe(false)
    expect(isGreyed(result, 2, ci('2'))).toBe(false)
  })

  it('error greys all teams on that column (question done)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E
    const result = computeGreyedOut(cells, columns)
    expect(isGreyed(result, 0, ci('1'))).toBe(true)
    expect(isGreyed(result, 1, ci('1'))).toBe(true)
    expect(isGreyed(result, 2, ci('1'))).toBe(true)
  })

  it('error greys ONLY the erroring team on the next question (toss-up)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors on Q1
    const result = computeGreyedOut(cells, columns)
    // Q2: only team 0 greyed (toss-up)
    expect(isGreyed(result, 0, ci('2'))).toBe(true)
    expect(isGreyed(result, 1, ci('2'))).toBe(false)
    expect(isGreyed(result, 2, ci('2'))).toBe(false)
    // Q2 is NOT a bonus for anyone
    expect(isBonusFor(result, 1, ci('2'))).toBe(false)
    expect(isBonusFor(result, 2, ci('2'))).toBe(false)
  })

  it('two errors in a row from different teams creates a bonus', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors on Q1
    cells[1]![0]![ci('2')] = E // team 1 errors on Q2 (toss-up)
    const result = computeGreyedOut(cells, columns)
    // Q3: team 0 and team 1 both greyed → bonus for team 2
    expect(isGreyed(result, 0, ci('3'))).toBe(true)
    expect(isGreyed(result, 1, ci('3'))).toBe(true)
    expect(isGreyed(result, 2, ci('3'))).toBe(false)
    expect(isBonusFor(result, 2, ci('3'))).toBe(true)
  })

  it('toss-up answered correctly breaks the chain', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors on Q1
    cells[1]![0]![ci('2')] = C // team 1 correct on Q2 (toss-up resolved)
    const result = computeGreyedOut(cells, columns)
    // Q3: nobody greyed — chain resolved
    expect(isGreyed(result, 0, ci('3'))).toBe(false)
    expect(isGreyed(result, 1, ci('3'))).toBe(false)
    expect(isGreyed(result, 2, ci('3'))).toBe(false)
  })

  it('foul does NOT grey out other teams or next question', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F
    const result = computeGreyedOut(cells, columns)
    // Q1 not greyed for any team (re-asked)
    expect(isGreyed(result, 0, ci('1'))).toBe(false)
    expect(isGreyed(result, 1, ci('1'))).toBe(false)
    // Q2 not greyed
    expect(isGreyed(result, 0, ci('2'))).toBe(false)
  })

  it('unanswered question does not propagate grey', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors on Q1
    // Q2 has no answer yet
    const result = computeGreyedOut(cells, columns)
    // Q2: team 0 greyed (toss-up)
    expect(isGreyed(result, 0, ci('2'))).toBe(true)
    // Q3: team 0 NOT greyed (Q2 unanswered, no carry)
    expect(isGreyed(result, 0, ci('3'))).toBe(false)
  })

  it('correct on base A/B question greys A and B columns', () => {
    const cells = blankCells()
    cells[0]![0]![ci('16')] = C
    const result = computeGreyedOut(cells, columns)
    expect(isGreyed(result, 0, ci('16A'))).toBe(true)
    expect(isGreyed(result, 1, ci('16A'))).toBe(true)
    expect(isGreyed(result, 0, ci('16B'))).toBe(true)
    expect(isGreyed(result, 1, ci('16B'))).toBe(true)
  })

  it('correct on A question greys B column', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17A')] = C
    const result = computeGreyedOut(cells, columns)
    expect(isGreyed(result, 0, ci('17B'))).toBe(true)
    expect(isGreyed(result, 1, ci('17B'))).toBe(true)
  })

  it('error on A/B normal → toss-up on A', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = E // team 0 errors on Q17
    const result = computeGreyedOut(cells, columns)
    // Q17A: team 0 greyed (toss-up)
    expect(isGreyed(result, 0, ci('17A'))).toBe(true)
    expect(isGreyed(result, 1, ci('17A'))).toBe(false)
  })

  it('error on A → toss-up on B', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17A')] = E
    const result = computeGreyedOut(cells, columns)
    expect(isGreyed(result, 0, ci('17B'))).toBe(true)
    expect(isGreyed(result, 1, ci('17B'))).toBe(false)
  })
})
