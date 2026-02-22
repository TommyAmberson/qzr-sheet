import { describe, it, expect } from 'vitest'
import { CellValue, buildColumns } from '../../types/scoresheet'
import { computeGreyedOut } from '../greyedOut'
import { validateCells, ValidationCode } from '../validation'

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

/** Check if a specific cell has a specific validation code */
function hasCode(
  errors: Map<string, ValidationCode[]>,
  ti: number,
  qi: number,
  colIdx: number,
  code: ValidationCode,
): boolean {
  const codes = errors.get(`${ti}:${qi}:${colIdx}`)
  return codes ? codes.includes(code) : false
}

/** Check if a specific cell has any validation error */
function hasAny(
  errors: Map<string, ValidationCode[]>,
  ti: number,
  qi: number,
  colIdx: number,
): boolean {
  return errors.has(`${ti}:${qi}:${colIdx}`)
}

describe('cell validation', () => {
  it('clean sheet has no errors', () => {
    const cells = blankCells()
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(errors.size).toBe(0)
  })

  it('single correct answer has no errors', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(errors.size).toBe(0)
  })

  it('single error has no validation errors', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(errors.size).toBe(0)
  })

  // --- Duplicate answers on same question ---

  it('two quizzers on same team answering same question is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[0]![1]![ci('1')] = E
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.DuplicateAnswer)).toBe(true)
    expect(hasCode(errors, 0, 1, ci('1'), ValidationCode.DuplicateAnswer)).toBe(true)
  })

  it('two quizzers on different teams answering same question is valid', () => {
    // This happens on toss-ups: T1 errors, T2 answers the toss-up
    // The error and toss-up answer are on different columns though...
    // Actually on the same column this shouldn't happen — only one answer per column.
    // But an error on Q1 and correct on Q2 is fine.
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E
    cells[1]![0]![ci('2')] = C
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(errors.size).toBe(0)
  })

  it('fouls on same column from same team are not duplicate answers', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F
    cells[0]![1]![ci('1')] = F
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.DuplicateAnswer)).toBe(false)
    expect(hasCode(errors, 0, 1, ci('1'), ValidationCode.DuplicateAnswer)).toBe(false)
  })

  it('foul + answer on same column from same team is not a duplicate', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F
    cells[0]![1]![ci('1')] = C
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.DuplicateAnswer)).toBe(false)
    expect(hasCode(errors, 0, 1, ci('1'), ValidationCode.DuplicateAnswer)).toBe(false)
  })

  // --- Answering when tossed up ---

  it('team answering on a column where they are tossed up is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors on Q1
    cells[0]![1]![ci('2')] = C // team 0 answers Q2 — but they're tossed up!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 1, ci('2'), ValidationCode.TossedUp)).toBe(true)
  })

  it('different team answering toss-up is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors on Q1
    cells[1]![0]![ci('2')] = C // team 1 answers Q2 toss-up — valid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasAny(errors, 1, 0, ci('2'))).toBe(false)
  })

  it('team answering bonus when not tossed up is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors Q1
    cells[1]![0]![ci('2')] = E // team 1 errors Q2 toss-up
    // Q3 is bonus for team 2 only
    cells[0]![1]![ci('3')] = B // team 0 answers Q3 bonus — they're tossed up!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 1, ci('3'), ValidationCode.TossedUp)).toBe(true)
  })

  // --- Multiple teams answering same column ---

  it('two teams with answers on the same column is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C // team 0 correct on Q1
    cells[1]![0]![ci('1')] = E // team 1 also answered Q1
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.MultipleTeams)).toBe(true)
    expect(hasCode(errors, 1, 0, ci('1'), ValidationCode.MultipleTeams)).toBe(true)
  })

  it('fouls from multiple teams on same column do not trigger multi-team error', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F
    cells[1]![0]![ci('1')] = F
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.MultipleTeams)).toBe(false)
    expect(hasCode(errors, 1, 0, ci('1'), ValidationCode.MultipleTeams)).toBe(false)
  })

  it('foul from one team + answer from another on same column is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F
    cells[1]![0]![ci('1')] = C
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.MultipleTeams)).toBe(false)
    expect(hasCode(errors, 1, 0, ci('1'), ValidationCode.MultipleTeams)).toBe(false)
  })

  // --- Wrong cell type for column ---

  it('C/E on a B column is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = C
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.WrongCellType)).toBe(true)
  })

  it('E on a B column is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = E
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.WrongCellType)).toBe(true)
  })

  it('B on a B column is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = B
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.WrongCellType)).toBe(false)
  })

  it('MB on a B column is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = MB
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.WrongCellType)).toBe(false)
  })

  it('B/MB on a normal column (non-bonus situation) is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = B // bonus on Q1 with no toss-up chain — invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.WrongCellType)).toBe(true)
  })

  it('B on a normal column in actual bonus situation is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors Q1
    cells[1]![0]![ci('2')] = E // team 1 errors Q2 toss-up
    cells[2]![0]![ci('3')] = B // team 2 bonus on Q3 — valid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('3'), ValidationCode.WrongCellType)).toBe(false)
  })

  it('C on a column that is a bonus situation is invalid (should be B)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('4')] = E // team 0 errors Q4
    cells[1]![0]![ci('5')] = E // team 1 errors Q5 toss-up
    cells[2]![0]![ci('6')] = C // team 2 marks C on Q6 — but it's a bonus!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('6'), ValidationCode.WrongCellType)).toBe(true)
  })

  it('E on a column that is a bonus situation is invalid (should be MB)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('4')] = E // team 0 errors Q4
    cells[1]![0]![ci('5')] = E // team 1 errors Q5 toss-up
    cells[2]![0]![ci('6')] = E // team 2 marks E on Q6 — but it's a bonus!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('6'), ValidationCode.WrongCellType)).toBe(true)
  })

  it('C/E marked first then errors added before — retroactively invalid', () => {
    // User marks Q6 as C first, then goes back and marks Q4 E, Q5 E
    // The C on Q6 should now be flagged
    const cells = blankCells()
    cells[2]![0]![ci('6')] = C // marked first
    cells[0]![0]![ci('4')] = E // added later
    cells[1]![0]![ci('5')] = E // added later
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('6'), ValidationCode.WrongCellType)).toBe(true)
  })

  // --- Answer on cascaded-grey column ---

  it('answer on A column when base question was correct is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = C  // Q17 correct
    cells[1]![0]![ci('17A')] = C // Q17A answered — but Q17 was already resolved!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 1, 0, ci('17A'), ValidationCode.QuestionResolved)).toBe(true)
  })

  it('answer on B column when A was correct is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = E  // Q17 error → toss-up to 17A
    cells[1]![0]![ci('17A')] = C // Q17A correct
    cells[2]![0]![ci('17B')] = B // Q17B answered — but 17A resolved it!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('17B'), ValidationCode.QuestionResolved)).toBe(true)
  })

  it('answer on A column when base question was error is valid (toss-up)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = E  // Q17 error
    cells[1]![0]![ci('17A')] = C // Q17A correct via toss-up — valid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 1, 0, ci('17A'), ValidationCode.QuestionResolved)).toBe(false)
  })
})
