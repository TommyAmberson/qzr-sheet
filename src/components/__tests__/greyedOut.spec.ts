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
function isGreyed(result: { disabled: Set<string> }, ti: number, colIdx: number): boolean {
  return result.disabled.has(`${ti}:${colIdx}`)
}

/** Helper: check if a column is a bonus for a team (other 2 teams tossed-up) */
function isBonusFor(result: { tossedUp: Set<string> }, ti: number, colIdx: number, teamCount = 3): boolean {
  let tossedTeams = 0
  for (let t = 0; t < teamCount; t++) {
    if (t !== ti && result.tossedUp.has(`${t}:${colIdx}`)) tossedTeams++
  }
  return tossedTeams === teamCount - 1
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

  it('error on base A/B question does NOT grey out A and B for all teams', () => {
    const cells = blankCells()
    cells[0]![0]![ci('16')] = E // team 0 errors on Q16
    const result = computeGreyedOut(cells, columns)
    // Q16 is done (greyed for all)
    expect(isGreyed(result, 0, ci('16'))).toBe(true)
    expect(isGreyed(result, 1, ci('16'))).toBe(true)
    // Q16A: only team 0 greyed (toss-up), not all teams
    expect(isGreyed(result, 0, ci('16A'))).toBe(true)
    expect(isGreyed(result, 1, ci('16A'))).toBe(false)
    expect(isGreyed(result, 2, ci('16A'))).toBe(false)
    // Q16B: not greyed at all yet
    expect(isGreyed(result, 0, ci('16B'))).toBe(false)
    expect(isGreyed(result, 1, ci('16B'))).toBe(false)
  })

  it('missed bonus does NOT cause toss-up on next question', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = MB // team 0 misses bonus on Q17B
    const result = computeGreyedOut(cells, columns)
    // Q17B is done (greyed for all)
    expect(isGreyed(result, 0, ci('17B'))).toBe(true)
    // Q18: nobody greyed — MB doesn't cause toss-up
    expect(isGreyed(result, 0, ci('18'))).toBe(false)
    expect(isGreyed(result, 1, ci('18'))).toBe(false)
    expect(isGreyed(result, 2, ci('18'))).toBe(false)
  })

  it('bonus answer does NOT cause toss-up on next question', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = B // team 0 gets bonus on Q17B
    const result = computeGreyedOut(cells, columns)
    // Q18: nobody greyed
    expect(isGreyed(result, 0, ci('18'))).toBe(false)
    expect(isGreyed(result, 1, ci('18'))).toBe(false)
    expect(isGreyed(result, 2, ci('18'))).toBe(false)
  })

  // --- Q16 special cases ---

  it('Q15 error → Q16 is toss-up, Q16 error → Q16A is bonus, Q16B not asked', () => {
    const cells = blankCells()
    cells[0]![0]![ci('15')] = E // team 0 errors on Q15
    cells[1]![0]![ci('16')] = E // team 1 errors on Q16 (toss-up)
    const result = computeGreyedOut(cells, columns)
    // Q16: team 0 was greyed (toss-up from Q15 error)
    expect(isGreyed(result, 0, ci('16'))).toBe(true)
    // Q16A: team 0 carried forward + team 1 error → bonus for team 2
    expect(isGreyed(result, 0, ci('16A'))).toBe(true)
    expect(isGreyed(result, 1, ci('16A'))).toBe(true)
    expect(isGreyed(result, 2, ci('16A'))).toBe(false)
    expect(isBonusFor(result, 2, ci('16A'))).toBe(true)
  })

  it('Q16A bonus answered → Q16B not asked', () => {
    const cells = blankCells()
    cells[0]![0]![ci('15')] = E // team 0 errors on Q15
    cells[1]![0]![ci('16')] = E // team 1 errors on Q16 (toss-up)
    cells[2]![0]![ci('16A')] = B // team 2 gets bonus on Q16A
    const result = computeGreyedOut(cells, columns)
    // Q16A is done
    expect(isGreyed(result, 0, ci('16A'))).toBe(true)
    // Q16B: greyed for all (A was answered correctly via bonus)
    expect(isGreyed(result, 0, ci('16B'))).toBe(true)
    expect(isGreyed(result, 1, ci('16B'))).toBe(true)
    expect(isGreyed(result, 2, ci('16B'))).toBe(true)
  })

  it('Q16A bonus missed → Q16B not asked', () => {
    const cells = blankCells()
    cells[0]![0]![ci('15')] = E // team 0 errors on Q15
    cells[1]![0]![ci('16')] = E // team 1 errors on Q16 (toss-up)
    cells[2]![0]![ci('16A')] = MB // team 2 misses bonus on Q16A
    const result = computeGreyedOut(cells, columns)
    // Q16B: greyed for all — bonus was the last chance
    expect(isGreyed(result, 0, ci('16B'))).toBe(true)
    expect(isGreyed(result, 1, ci('16B'))).toBe(true)
    expect(isGreyed(result, 2, ci('16B'))).toBe(true)
  })

  it('Q16 is already a bonus (Q14+Q15 error chain) → Q16A and Q16B not asked', () => {
    const cells = blankCells()
    cells[0]![0]![ci('14')] = E // team 0 errors on Q14
    cells[1]![0]![ci('15')] = E // team 1 errors on Q15 (toss-up from Q14)
    // Q16: team 0 + team 1 greyed → bonus for team 2
    const result = computeGreyedOut(cells, columns)
    expect(isBonusFor(result, 2, ci('16'))).toBe(true)
    // Q16A and Q16B: not asked since Q16 is a bonus
    // (they should be greyed once Q16 is answered)
  })

  it('Q16 bonus answered → Q16A and Q16B greyed', () => {
    const cells = blankCells()
    cells[0]![0]![ci('14')] = E
    cells[1]![0]![ci('15')] = E
    cells[2]![0]![ci('16')] = B // team 2 gets Q16 bonus
    const result = computeGreyedOut(cells, columns)
    expect(isGreyed(result, 0, ci('16A'))).toBe(true)
    expect(isGreyed(result, 1, ci('16A'))).toBe(true)
    expect(isGreyed(result, 2, ci('16A'))).toBe(true)
    expect(isGreyed(result, 0, ci('16B'))).toBe(true)
    expect(isGreyed(result, 1, ci('16B'))).toBe(true)
    expect(isGreyed(result, 2, ci('16B'))).toBe(true)
  })

  it('Q16 bonus missed → Q16A and Q16B greyed', () => {
    const cells = blankCells()
    cells[0]![0]![ci('14')] = E
    cells[1]![0]![ci('15')] = E
    cells[2]![0]![ci('16')] = MB // team 2 misses Q16 bonus
    const result = computeGreyedOut(cells, columns)
    expect(isGreyed(result, 0, ci('16A'))).toBe(true)
    expect(isGreyed(result, 1, ci('16A'))).toBe(true)
    expect(isGreyed(result, 2, ci('16A'))).toBe(true)
    expect(isGreyed(result, 0, ci('16B'))).toBe(true)
    expect(isGreyed(result, 1, ci('16B'))).toBe(true)
    expect(isGreyed(result, 2, ci('16B'))).toBe(true)
  })

  // --- Quizzer foul on A/B question greys subsequent sub-parts ---

  it('quizzer foul on base A/B question greys that quizzer on A and B', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = F // team 0, quizzer 0 fouls on Q17
    const result = computeGreyedOut(cells, columns)
    expect(result.fouledQuizzers.has(`0:0:${ci('17A')}`)).toBe(true)
    expect(result.fouledQuizzers.has(`0:0:${ci('17B')}`)).toBe(true)
    // Other quizzers on the same team are NOT affected
    expect(result.fouledQuizzers.has(`0:1:${ci('17A')}`)).toBe(false)
    // Other teams are NOT affected
    expect(result.fouledQuizzers.has(`1:0:${ci('17A')}`)).toBe(false)
  })

  it('quizzer foul on A question greys that quizzer on B', () => {
    const cells = blankCells()
    cells[1]![2]![ci('18A')] = F // team 1, quizzer 2 fouls on Q18A
    const result = computeGreyedOut(cells, columns)
    expect(result.fouledQuizzers.has(`1:2:${ci('18B')}`)).toBe(true)
    // NOT greyed on 18A itself (that's where the foul happened)
    expect(result.fouledQuizzers.has(`1:2:${ci('18A')}`)).toBe(false)
  })

  it('quizzer foul on B question does not propagate further', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17B')] = F // foul on B — nowhere to propagate
    const result = computeGreyedOut(cells, columns)
    // No fouledQuizzers entries for Q18 or beyond from this
    expect(result.fouledQuizzers.has(`0:0:${ci('18')}`)).toBe(false)
  })

  it('foul on normal (non-AB) question does not create fouledQuizzers entries', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = F // Q1 is not A/B
    const result = computeGreyedOut(cells, columns)
    expect(result.fouledQuizzers.size).toBe(0)
  })

  it('foul on Q16 (AB but not error-points) still greys quizzer on 16A and 16B', () => {
    const cells = blankCells()
    cells[2]![1]![ci('16')] = F // team 2, quizzer 1 fouls on Q16
    const result = computeGreyedOut(cells, columns)
    expect(result.fouledQuizzers.has(`2:1:${ci('16A')}`)).toBe(true)
    expect(result.fouledQuizzers.has(`2:1:${ci('16B')}`)).toBe(true)
  })

  // --- cascadeDisabled ---

  it('cascadeDisabled includes A and B when base question is correct', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = C
    const result = computeGreyedOut(cells, columns)
    expect(result.cascadeDisabled.has(ci('17A'))).toBe(true)
    expect(result.cascadeDisabled.has(ci('17B'))).toBe(true)
  })

  it('cascadeDisabled includes B when A is resolved (correct)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = E  // error on base → toss-up to A
    cells[1]![0]![ci('17A')] = C // A correct → B disabled
    const result = computeGreyedOut(cells, columns)
    expect(result.cascadeDisabled.has(ci('17A'))).toBe(false) // A was the toss-up, not cascade-disabled
    expect(result.cascadeDisabled.has(ci('17B'))).toBe(true)
  })

  it('cascadeDisabled includes A and B when base is bonus (B answer)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('16')] = B // bonus on base
    const result = computeGreyedOut(cells, columns)
    expect(result.cascadeDisabled.has(ci('16A'))).toBe(true)
    expect(result.cascadeDisabled.has(ci('16B'))).toBe(true)
  })

  it('cascadeDisabled includes A and B when base is missed bonus (MB)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('16')] = MB
    const result = computeGreyedOut(cells, columns)
    expect(result.cascadeDisabled.has(ci('16A'))).toBe(true)
    expect(result.cascadeDisabled.has(ci('16B'))).toBe(true)
  })

  it('cascadeDisabled includes B when A is bonus/missed-bonus', () => {
    const cells = blankCells()
    cells[0]![0]![ci('18')] = E   // error on base
    cells[1]![0]![ci('18A')] = MB // missed bonus on A → B disabled
    const result = computeGreyedOut(cells, columns)
    expect(result.cascadeDisabled.has(ci('18B'))).toBe(true)
  })

  it('cascadeDisabled does NOT include A when base has error (toss-up, not cascade)', () => {
    const cells = blankCells()
    cells[0]![0]![ci('17')] = E // error on base
    const result = computeGreyedOut(cells, columns)
    expect(result.cascadeDisabled.has(ci('17A'))).toBe(false)
    expect(result.cascadeDisabled.has(ci('17B'))).toBe(false)
  })

  it('cascadeDisabled does NOT include non-AB columns', () => {
    const cells = blankCells()
    cells[0]![0]![ci('1')] = C
    const result = computeGreyedOut(cells, columns)
    // Q2 is not cascade-disabled, it's just a different question
    expect(result.cascadeDisabled.has(ci('2'))).toBe(false)
  })

  it('cascadeDisabled is empty for a clean sheet', () => {
    const cells = blankCells()
    const result = computeGreyedOut(cells, columns)
    expect(result.cascadeDisabled.size).toBe(0)
  })

  // --- Overtime eligibility greying ---

  it('non-eligible teams are greyed on overtime columns', () => {
    const otCols = buildColumns(1)
    const otCells = [0, 1, 2].map(() =>
      Array.from({ length: 5 }, () => otCols.map(() => _)),
    )
    const otCi = (key: string) => {
      const i = otCols.findIndex((c) => c.key === key)
      if (i === -1) throw new Error(`Column ${key} not found`)
      return i
    }
    // Only teams 0 and 1 eligible
    const eligible = new Set([0, 1])
    const result = computeGreyedOut(otCells, otCols, eligible)
    // Team 2 greyed on all OT columns
    expect(isGreyed(result, 2, otCi('21'))).toBe(true)
    expect(isGreyed(result, 2, otCi('22'))).toBe(true)
    expect(isGreyed(result, 2, otCi('23'))).toBe(true)
    // Teams 0 and 1 NOT greyed
    expect(isGreyed(result, 0, otCi('21'))).toBe(false)
    expect(isGreyed(result, 1, otCi('21'))).toBe(false)
  })

  it('eligible teams are NOT greyed on regulation columns', () => {
    const otCols = buildColumns(1)
    const otCells = [0, 1, 2].map(() =>
      Array.from({ length: 5 }, () => otCols.map(() => _)),
    )
    const otCi = (key: string) => {
      const i = otCols.findIndex((c) => c.key === key)
      if (i === -1) throw new Error(`Column ${key} not found`)
      return i
    }
    const eligible = new Set([0, 1])
    const result = computeGreyedOut(otCells, otCols, eligible)
    // Team 2 NOT greyed on regulation
    expect(isGreyed(result, 2, otCi('1'))).toBe(false)
    expect(isGreyed(result, 2, otCi('15'))).toBe(false)
  })
})
