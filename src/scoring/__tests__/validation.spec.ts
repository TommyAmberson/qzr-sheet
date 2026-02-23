import { describe, it, expect } from 'vitest'
import { CellValue, buildColumns } from '../../types/scoresheet'
import { computeGreyedOut } from '../greyedOut'
import { validateCells, ValidationCode, validationMessage } from '../validation'
import { getOvertimeEligibleTeams } from '../overtime'
import { computeOrphanedColumns } from '../columnVisibility'

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

/** Helper: blank no-jumps array */
function blankNoJumps(): boolean[] {
  return columns.map(() => false)
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

describe('validationMessage', () => {
  it('returns a non-empty string for every ValidationCode', () => {
    for (const code of Object.values(ValidationCode)) {
      const msg = validationMessage(code)
      expect(typeof msg).toBe('string')
      expect(msg.length).toBeGreaterThan(0)
    }
  })
})

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

  it('team answering bonus that belongs to another team is WrongTeamBonus', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors Q1
    cells[1]![0]![ci('2')] = E // team 1 errors Q2 toss-up
    // Q3 is bonus for team 2 only
    cells[0]![1]![ci('3')] = B // team 0 answers Q3 bonus — wrong team!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 1, ci('3'), ValidationCode.WrongTeamBonus)).toBe(true)
    expect(hasCode(errors, 0, 1, ci('3'), ValidationCode.TossedUp)).toBe(false)
  })

  it('toss-up (not bonus) uses TossedUp not WrongTeamBonus', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors on Q1
    cells[0]![1]![ci('2')] = C // team 0 answers Q2 — tossed up but not a bonus
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 1, ci('2'), ValidationCode.TossedUp)).toBe(true)
    expect(hasCode(errors, 0, 1, ci('2'), ValidationCode.WrongTeamBonus)).toBe(false)
  })

  it('correct team answering bonus is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors Q1
    cells[1]![0]![ci('2')] = E // team 1 errors Q2 toss-up
    // Q3 is bonus for team 2
    cells[2]![0]![ci('3')] = B // team 2 answers Q3 bonus — valid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasAny(errors, 2, 0, ci('3'))).toBe(false)
  })

  // --- Multiple teams answering same column ---

  it('two teams with answers on the same column is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C // team 0 correct on Q1
    cells[1]![0]![ci('1')] = E // team 1 also answered Q1
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.DuplicateAnswer)).toBe(true)
    expect(hasCode(errors, 1, 0, ci('1'), ValidationCode.DuplicateAnswer)).toBe(true)
  })

  it('fouls from multiple teams on same column do not trigger duplicate answer', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F
    cells[1]![0]![ci('1')] = F
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.DuplicateAnswer)).toBe(false)
    expect(hasCode(errors, 1, 0, ci('1'), ValidationCode.DuplicateAnswer)).toBe(false)
  })

  it('foul from one team + answer from another on same column is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F
    cells[1]![0]![ci('1')] = C
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.DuplicateAnswer)).toBe(false)
    expect(hasCode(errors, 1, 0, ci('1'), ValidationCode.DuplicateAnswer)).toBe(false)
  })

  // --- Wrong cell type for column ---

  it('C/E on a B column is invalid (IsBonus)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = C
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.IsBonus)).toBe(true)
  })

  it('E on a B column is invalid (IsBonus)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = E
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.IsBonus)).toBe(true)
  })

  it('B on a B column is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = B
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.IsBonus)).toBe(false)
  })

  it('MB on a B column is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = MB
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.IsBonus)).toBe(false)
  })

  it('F on a B column is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = F
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.IsBonus)).toBe(false)
  })

  it('B/MB on a normal column (non-bonus situation) is invalid (NotBonus)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = B // bonus on Q1 with no toss-up chain — invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.NotBonus)).toBe(true)
  })

  it('MB on a normal column (non-bonus situation) is invalid (NotBonus)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = MB // missed bonus on Q1 with no toss-up chain — invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('1'), ValidationCode.NotBonus)).toBe(true)
  })

  it('B on a normal column in actual bonus situation is valid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E // team 0 errors Q1
    cells[1]![0]![ci('2')] = E // team 1 errors Q2 toss-up
    cells[2]![0]![ci('3')] = B // team 2 bonus on Q3 — valid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('3'), ValidationCode.NotBonus)).toBe(false)
    expect(hasCode(errors, 2, 0, ci('3'), ValidationCode.IsBonus)).toBe(false)
  })

  it('C on a column that is a bonus situation is invalid (IsBonus)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('4')] = E // team 0 errors Q4
    cells[1]![0]![ci('5')] = E // team 1 errors Q5 toss-up
    cells[2]![0]![ci('6')] = C // team 2 marks C on Q6 — but it's a bonus!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('6'), ValidationCode.IsBonus)).toBe(true)
  })

  it('E on a column that is a bonus situation is invalid (IsBonus)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('4')] = E // team 0 errors Q4
    cells[1]![0]![ci('5')] = E // team 1 errors Q5 toss-up
    cells[2]![0]![ci('6')] = E // team 2 marks E on Q6 — but it's a bonus!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('6'), ValidationCode.IsBonus)).toBe(true)
  })

  it('C/E marked first then errors added before — retroactively invalid (IsBonus)', () => {
    // User marks Q6 as C first, then goes back and marks Q4 E, Q5 E
    // The C on Q6 should now be flagged
    const cells = blankCells()
    cells[2]![0]![ci('6')] = C // marked first
    cells[0]![0]![ci('4')] = E // added later
    cells[1]![0]![ci('5')] = E // added later
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('6'), ValidationCode.IsBonus)).toBe(true)
  })

  // --- Answer on cascaded-grey column ---

  it('answer on A column when base question was correct is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = C  // Q17 correct
    cells[1]![0]![ci('17A')] = C // Q17A answered — but Q17 was already resolved!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 1, 0, ci('17A'), ValidationCode.QuestionNotNeeded)).toBe(true)
  })

  it('answer on B column when A was correct is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = E  // Q17 error → toss-up to 17A
    cells[1]![0]![ci('17A')] = C // Q17A correct
    cells[2]![0]![ci('17B')] = B // Q17B answered — but 17A resolved it!
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 2, 0, ci('17B'), ValidationCode.QuestionNotNeeded)).toBe(true)
  })

  it('answer on A column when base question was error is valid (toss-up)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = E  // Q17 error
    cells[1]![0]![ci('17A')] = C // Q17A correct via toss-up — valid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 1, 0, ci('17A'), ValidationCode.QuestionNotNeeded)).toBe(false)
  })

  // --- No-jump violations ---

  it('answer on a no-jump column is invalid', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    noJumps[ci('3')] = true
    cells[0]![0]![ci('3')] = C
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey, noJumps)
    expect(hasCode(errors, 0, 0, ci('3'), ValidationCode.NoJump)).toBe(true)
  })

  it('foul on a no-jump column is valid', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    noJumps[ci('3')] = true
    cells[0]![0]![ci('3')] = F
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey, noJumps)
    expect(hasCode(errors, 0, 0, ci('3'), ValidationCode.NoJump)).toBe(false)
  })

  it('empty cell on a no-jump column has no error', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    noJumps[ci('3')] = true
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey, noJumps)
    expect(errors.size).toBe(0)
  })

  it('answer on a column without no-jump is not flagged', () => {
    const cells = blankCells()
    const noJumps = blankNoJumps()
    cells[0]![0]![ci('3')] = C
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey, noJumps)
    expect(hasCode(errors, 0, 0, ci('3'), ValidationCode.NoJump)).toBe(false)
  })

  // --- Quizzer out violations ---

  it('correct answer after quiz-out (4 correct) is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[0]![0]![ci('2')] = C
    cells[0]![0]![ci('3')] = C
    cells[0]![0]![ci('4')] = C // quizzed out
    cells[0]![0]![ci('5')] = C // should be invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('5'), ValidationCode.QuizzerOut)).toBe(true)
    // The 4th correct itself should NOT be flagged
    expect(hasCode(errors, 0, 0, ci('4'), ValidationCode.QuizzerOut)).toBe(false)
  })

  it('error after quiz-out is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[0]![0]![ci('2')] = C
    cells[0]![0]![ci('3')] = C
    cells[0]![0]![ci('4')] = C // quizzed out
    cells[0]![0]![ci('5')] = E // should be invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('5'), ValidationCode.QuizzerOut)).toBe(true)
  })

  it('foul after quiz-out is NOT invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[0]![0]![ci('2')] = C
    cells[0]![0]![ci('3')] = C
    cells[0]![0]![ci('4')] = C // quizzed out
    cells[0]![0]![ci('5')] = F // fouls are still allowed
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('5'), ValidationCode.QuizzerOut)).toBe(false)
  })

  it('correct answer after error-out (3 errors) is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E
    cells[0]![0]![ci('2')] = E
    cells[0]![0]![ci('3')] = E // errored out
    cells[0]![0]![ci('4')] = C // should be invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('4'), ValidationCode.QuizzerOut)).toBe(true)
  })

  it('foul after error-out is NOT invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E
    cells[0]![0]![ci('2')] = E
    cells[0]![0]![ci('3')] = E // errored out
    cells[0]![0]![ci('5')] = F // fouls still allowed
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('5'), ValidationCode.QuizzerOut)).toBe(false)
  })

  it('error after foul-out (3 fouls) is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F
    cells[0]![0]![ci('2')] = F
    cells[0]![0]![ci('3')] = F // fouled out
    cells[0]![0]![ci('4')] = E // should be invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('4'), ValidationCode.QuizzerOut)).toBe(true)
  })

  it('2 errors + 1 foul is NOT out (errors and fouls tracked separately)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E
    cells[0]![0]![ci('2')] = F
    cells[0]![0]![ci('3')] = E // 2 errors + 1 foul: NOT out
    cells[0]![0]![ci('4')] = C // should be valid — quizzer is still in
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('4'), ValidationCode.QuizzerOut)).toBe(false)
  })

  it('quizzer not yet out has no QuizzerOut error', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[0]![0]![ci('2')] = C
    cells[0]![0]![ci('3')] = C // 3 correct, not 4
    cells[0]![0]![ci('4')] = C // 4th correct = quiz-out, not invalid itself
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('4'), ValidationCode.QuizzerOut)).toBe(false)
  })

  it('bonus answer after quiz-out is valid (stays on bench)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[0]![0]![ci('2')] = C
    cells[0]![0]![ci('3')] = C
    cells[0]![0]![ci('4')] = C // quizzed out
    cells[0]![0]![ci('17B')] = B // stays on bench, can answer bonus
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.QuizzerOut)).toBe(false)
  })

  it('missed bonus after quiz-out is valid (stays on bench)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    cells[0]![0]![ci('2')] = C
    cells[0]![0]![ci('3')] = C
    cells[0]![0]![ci('4')] = C // quizzed out
    cells[0]![0]![ci('17B')] = MB // stays on bench, can attempt bonus
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.QuizzerOut)).toBe(false)
  })

  it('bonus answer after error-out is invalid (must leave)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = E
    cells[0]![0]![ci('2')] = E
    cells[0]![0]![ci('3')] = E // errored out
    cells[0]![0]![ci('17B')] = B // must leave, can't answer bonus
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.QuizzerOut)).toBe(true)
  })

  it('bonus answer after foul-out is invalid (must leave)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F
    cells[0]![0]![ci('2')] = F
    cells[0]![0]![ci('3')] = F // fouled out
    cells[0]![0]![ci('17B')] = B // must leave, can't answer bonus
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.QuizzerOut)).toBe(true)
  })

  // --- Foul on question blocks quizzer from sub-parts ---

  it('quizzer who fouled on base question answering A is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = F  // quizzer 0 fouls on Q17
    cells[0]![0]![ci('17A')] = C // quizzer 0 answers Q17A — invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17A'), ValidationCode.FouledOnQuestion)).toBe(true)
  })

  it('quizzer who fouled on base question answering B is invalid', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = F  // quizzer 0 fouls on Q17
    cells[0]![0]![ci('17B')] = B // quizzer 0 answers Q17B — invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.FouledOnQuestion)).toBe(true)
  })

  it('quizzer who fouled on A question answering B is invalid', () => {
    const cells = blankCells()
    cells[1]![2]![ci('18A')] = F // quizzer 2 fouls on Q18A
    cells[1]![2]![ci('18B')] = B // quizzer 2 answers Q18B — invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 1, 2, ci('18B'), ValidationCode.FouledOnQuestion)).toBe(true)
  })

  it('different quizzer on same team can still answer after teammate foul', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = F  // quizzer 0 fouls on Q17
    cells[0]![1]![ci('17A')] = C // quizzer 1 answers Q17A — valid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 1, ci('17A'), ValidationCode.FouledOnQuestion)).toBe(false)
  })

  it('fouling again on a sub-part after fouling on base is still flagged', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = F  // quizzer 0 fouls on Q17
    cells[0]![0]![ci('17A')] = F // quizzer 0 fouls again on Q17A — invalid
    const grey = computeGreyedOut(cells, columns)
    const errors = validateCells(cells, columns, grey)
    expect(hasCode(errors, 0, 0, ci('17A'), ValidationCode.FouledOnQuestion)).toBe(true)
  })

  // --- Column not active (orphaned columns) ---

  it('content on A column without parent error is QuestionNotNeeded', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17A')] = C // no error on Q17
    const grey = computeGreyedOut(cells, columns)
    const orphaned = computeOrphanedColumns(cells, columns, blankNoJumps(), 0)
    const errors = validateCells(cells, columns, grey, blankNoJumps(), undefined, orphaned)
    expect(hasCode(errors, 0, 0, ci('17A'), ValidationCode.QuestionNotNeeded)).toBe(true)
  })

  it('content on B column without A error is QuestionNotNeeded', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = B // no error on Q17A
    const grey = computeGreyedOut(cells, columns)
    const orphaned = computeOrphanedColumns(cells, columns, blankNoJumps(), 0)
    const errors = validateCells(cells, columns, grey, blankNoJumps(), undefined, orphaned)
    expect(hasCode(errors, 0, 0, ci('17B'), ValidationCode.QuestionNotNeeded)).toBe(true)
  })

  it('content on A column with parent error is NOT QuestionNotNeeded', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = E // error triggers 17A
    cells[1]![0]![ci('17A')] = C
    const grey = computeGreyedOut(cells, columns)
    const orphaned = computeOrphanedColumns(cells, columns, blankNoJumps(), 0)
    const errors = validateCells(cells, columns, grey, blankNoJumps(), undefined, orphaned)
    expect(hasCode(errors, 1, 0, ci('17A'), ValidationCode.QuestionNotNeeded)).toBe(false)
  })

  it('foul on orphaned A/B column is still QuestionNotNeeded', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17A')] = F // foul on orphaned column
    const grey = computeGreyedOut(cells, columns)
    const orphaned = computeOrphanedColumns(cells, columns, blankNoJumps(), 0)
    const errors = validateCells(cells, columns, grey, blankNoJumps(), undefined, orphaned)
    expect(hasCode(errors, 0, 0, ci('17A'), ValidationCode.QuestionNotNeeded)).toBe(true)
  })

  // --- Not in overtime ---
  // OT tests need columns with OT rounds so column 21+ exist
  describe('overtime validation', () => {
    const otColumns = buildColumns(2)

    function otCi(key: string): number {
      const idx = otColumns.findIndex((c) => c.key === key)
      if (idx === -1) throw new Error(`Column ${key} not found`)
      return idx
    }

    function otBlankCells(): CellValue[][][] {
      return [0, 1, 2].map(() =>
        Array.from({ length: 5 }, () => otColumns.map(() => _)),
      )
    }

    function otBlankNoJumps(): boolean[] {
      return otColumns.map(() => false)
    }

    function otEligibleOt(cells: CellValue[][][], onTimes = [true, true, true]): Set<number> {
      return getOvertimeEligibleTeams(cells, otColumns, onTimes)
    }

    function otHasCode(
      errors: Map<string, ValidationCode[]>,
      ti: number,
      qi: number,
      colIdx: number,
      code: ValidationCode,
    ): boolean {
      const codes = errors.get(`${ti}:${qi}:${colIdx}`)
      return codes ? codes.includes(code) : false
    }

    it('team not part of the tie answering OT question is invalid', () => {
      const cells = otBlankCells()
      // Team 0: 3 correct = 80 (60 + 20 on-time)
      cells[0]![0]![otCi('1')] = C
      cells[0]![1]![otCi('2')] = C
      cells[0]![2]![otCi('3')] = C
      // Teams 1 and 2: 1 correct each = 40 (20 + 20 on-time) — tied
      cells[1]![0]![otCi('4')] = C
      cells[2]![0]![otCi('5')] = C
      const eligible = otEligibleOt(cells)
      // Team 0 is not tied, teams 1 & 2 are
      expect(eligible.has(0)).toBe(false)
      expect(eligible.has(1)).toBe(true)
      expect(eligible.has(2)).toBe(true)

      // Team 0 answers OT question — invalid
      cells[0]![3]![otCi('21')] = C
      const grey = computeGreyedOut(cells, otColumns)
      const errors = validateCells(cells, otColumns, grey, otBlankNoJumps(), eligible)
      expect(otHasCode(errors, 0, 3, otCi('21'), ValidationCode.NotInOvertime)).toBe(true)
    })

    it('team part of the tie answering OT question is valid', () => {
      const cells = otBlankCells()
      // Both team 0 and team 1 get one correct each — tied at 40
      cells[0]![0]![otCi('1')] = C
      cells[1]![0]![otCi('2')] = C
      const eligible = otEligibleOt(cells)
      expect(eligible.has(0)).toBe(true)
      expect(eligible.has(1)).toBe(true)

      cells[0]![1]![otCi('21')] = C
      const grey = computeGreyedOut(cells, otColumns)
      const errors = validateCells(cells, otColumns, grey, otBlankNoJumps(), eligible)
      expect(otHasCode(errors, 0, 1, otCi('21'), ValidationCode.NotInOvertime)).toBe(false)
    })

    it('foul on OT question by non-eligible team is not flagged (fouls always valid)', () => {
      const cells = otBlankCells()
      // Team 0 high score, teams 1 & 2 tied lower
      cells[0]![0]![otCi('1')] = C
      cells[0]![1]![otCi('2')] = C
      cells[1]![0]![otCi('3')] = C
      cells[2]![0]![otCi('4')] = C
      const eligible = otEligibleOt(cells)
      expect(eligible.has(0)).toBe(false)

      cells[0]![2]![otCi('21')] = F // foul is always allowed
      const grey = computeGreyedOut(cells, otColumns)
      const errors = validateCells(cells, otColumns, grey, otBlankNoJumps(), eligible)
      expect(otHasCode(errors, 0, 2, otCi('21'), ValidationCode.NotInOvertime)).toBe(false)
    })

    it('all three teams tied — all can answer OT', () => {
      const cells = otBlankCells()
      cells[0]![0]![otCi('1')] = C
      cells[1]![0]![otCi('2')] = C
      cells[2]![0]![otCi('3')] = C
      const eligible = otEligibleOt(cells)
      expect(eligible.has(0)).toBe(true)
      expect(eligible.has(1)).toBe(true)
      expect(eligible.has(2)).toBe(true)

      cells[0]![1]![otCi('21')] = C
      cells[1]![1]![otCi('22')] = C
      cells[2]![1]![otCi('23')] = C
      const grey = computeGreyedOut(cells, otColumns)
      const errors = validateCells(cells, otColumns, grey, otBlankNoJumps(), eligible)
      expect(otHasCode(errors, 0, 1, otCi('21'), ValidationCode.NotInOvertime)).toBe(false)
      expect(otHasCode(errors, 1, 1, otCi('22'), ValidationCode.NotInOvertime)).toBe(false)
      expect(otHasCode(errors, 2, 1, otCi('23'), ValidationCode.NotInOvertime)).toBe(false)
    })

    it('no eligible teams passed — no NotInOvertime errors', () => {
      const cells = otBlankCells()
      cells[0]![0]![otCi('21')] = C
      const grey = computeGreyedOut(cells, otColumns)
      // No otEligibleTeams parameter — should not flag
      const errors = validateCells(cells, otColumns, grey)
      expect(otHasCode(errors, 0, 0, otCi('21'), ValidationCode.NotInOvertime)).toBe(false)
    })

    it('content on OT column beyond visible rounds is QuestionNotNeeded', () => {
      const cells = otBlankCells()
      cells[0]![0]![otCi('21')] = C
      const grey = computeGreyedOut(cells, otColumns)
      const orphaned = computeOrphanedColumns(cells, otColumns, otBlankNoJumps(), 0)
      const errors = validateCells(cells, otColumns, grey, otBlankNoJumps(), undefined, orphaned)
      expect(otHasCode(errors, 0, 0, otCi('21'), ValidationCode.QuestionNotNeeded)).toBe(true)
    })

    it('content on OT column within visible rounds is NOT QuestionNotNeeded', () => {
      const cells = otBlankCells()
      cells[0]![0]![otCi('21')] = C
      const grey = computeGreyedOut(cells, otColumns)
      const orphaned = computeOrphanedColumns(cells, otColumns, otBlankNoJumps(), 1)
      const errors = validateCells(cells, otColumns, grey, otBlankNoJumps(), undefined, orphaned)
      expect(otHasCode(errors, 0, 0, otCi('21'), ValidationCode.QuestionNotNeeded)).toBe(false)
    })

    it('team not tied at highest score cannot answer OT', () => {
      const cells = otBlankCells()
      // Team 0: 3 correct = 80 (60 + 20 on-time)
      cells[0]![0]![otCi('1')] = C
      cells[0]![1]![otCi('2')] = C
      cells[0]![2]![otCi('3')] = C
      // Teams 1 and 2: 1 correct each = 40 (20 + 20 on-time) — tied but not highest
      cells[1]![0]![otCi('4')] = C
      cells[2]![0]![otCi('5')] = C
      const eligible = otEligibleOt(cells)
      // Only teams 1 & 2 are tied — team 0 is not in the tie
      expect(eligible.has(0)).toBe(false)

      cells[0]![3]![otCi('21')] = C // team 0 answers OT — shouldn't be in OT
      const grey = computeGreyedOut(cells, otColumns)
      const errors = validateCells(cells, otColumns, grey, otBlankNoJumps(), eligible)
      expect(otHasCode(errors, 0, 3, otCi('21'), ValidationCode.NotInOvertime)).toBe(true)
    })
  })
})
