import { describe, it, expect } from 'vitest'
import { CellValue } from '../../types/scoresheet'
import {
  isAnswer,
  isResolved,
  teamHasValue,
  teamHasAnswer,
  anyTeamHasAnswer,
  anyTeamHasValue,
  colHasAnyContent,
  isBonusSituation,
} from '../helpers'

// Shorthand builders for 3D cell grids [teamIdx][quizzerIdx][colIdx]
const E = CellValue.Empty
const C = CellValue.Correct
const Err = CellValue.Error
const F = CellValue.Foul
const B = CellValue.Bonus
const MB = CellValue.MissedBonus

/** Build a 3-team × 1-quizzer × n-col grid with all cells empty */
function emptyGrid(cols = 3): CellValue[][][] {
  return [[[...Array(cols).fill(E)]], [[...Array(cols).fill(E)]], [[...Array(cols).fill(E)]]]
}

/** Set one cell in a cloned grid */
function withCell(
  grid: CellValue[][][],
  teamIdx: number,
  seatIdx: number,
  colIdx: number,
  v: CellValue,
): CellValue[][][] {
  const g = grid.map((team) => team.map((row) => [...row]))
  g[teamIdx]![seatIdx]![colIdx] = v
  return g
}

describe('isAnswer', () => {
  it('returns true for Correct', () => expect(isAnswer(C)).toBe(true))
  it('returns true for Error', () => expect(isAnswer(Err)).toBe(true))
  it('returns true for Bonus', () => expect(isAnswer(B)).toBe(true))
  it('returns true for MissedBonus', () => expect(isAnswer(MB)).toBe(true))
  it('returns false for Foul (fouls are not answers)', () => expect(isAnswer(F)).toBe(false))
  it('returns false for Empty', () => expect(isAnswer(E)).toBe(false))
})

describe('isResolved', () => {
  it('returns false when column is all empty', () => {
    expect(isResolved(emptyGrid(), 0)).toBe(false)
  })

  it('returns true when a team has Correct on the column', () => {
    const g = withCell(emptyGrid(), 0, 0, 0, C)
    expect(isResolved(g, 0)).toBe(true)
  })

  it('returns true when a team has Bonus on the column', () => {
    const g = withCell(emptyGrid(), 1, 0, 0, B)
    expect(isResolved(g, 0)).toBe(true)
  })

  it('returns true when a team has MissedBonus on the column', () => {
    const g = withCell(emptyGrid(), 2, 0, 0, MB)
    expect(isResolved(g, 0)).toBe(true)
  })

  it('returns false when only Error exists (errored, not resolved)', () => {
    const g = withCell(emptyGrid(), 0, 0, 0, Err)
    expect(isResolved(g, 0)).toBe(false)
  })

  it('returns false when only Foul exists', () => {
    const g = withCell(emptyGrid(), 0, 0, 0, F)
    expect(isResolved(g, 0)).toBe(false)
  })

  it('checks the correct column index', () => {
    const g = withCell(emptyGrid(3), 0, 0, 2, C) // resolved at col 2, not col 0
    expect(isResolved(g, 0)).toBe(false)
    expect(isResolved(g, 2)).toBe(true)
  })
})

describe('teamHasValue', () => {
  it('returns false for an empty grid', () => {
    expect(teamHasValue(emptyGrid(), 0, 0, C)).toBe(false)
  })

  it('returns true when the target team has the value', () => {
    const g = withCell(emptyGrid(), 0, 0, 0, C)
    expect(teamHasValue(g, 0, 0, C)).toBe(true)
  })

  it('returns false when a different team has the value', () => {
    const g = withCell(emptyGrid(), 1, 0, 0, C)
    expect(teamHasValue(g, 0, 0, C)).toBe(false)
  })

  it('returns false when the team has a different value', () => {
    const g = withCell(emptyGrid(), 0, 0, 0, Err)
    expect(teamHasValue(g, 0, 0, C)).toBe(false)
  })

  it('checks across all quizzers on the team', () => {
    // 2-quizzer grid
    const grid: CellValue[][][] = [
      [
        [E, E],
        [C, E],
      ], // team 0: quizzer 1 has Correct on col 0
      [
        [E, E],
        [E, E],
      ],
    ]
    expect(teamHasValue(grid, 0, 0, C)).toBe(true)
  })
})

describe('teamHasAnswer', () => {
  it('returns false when all cells are empty', () => {
    expect(teamHasAnswer(emptyGrid(), 0, 0)).toBe(false)
  })

  it('returns true for Correct', () => {
    expect(teamHasAnswer(withCell(emptyGrid(), 0, 0, 0, C), 0, 0)).toBe(true)
  })

  it('returns true for Error', () => {
    expect(teamHasAnswer(withCell(emptyGrid(), 0, 0, 0, Err), 0, 0)).toBe(true)
  })

  it('returns false for Foul (foul is not an answer)', () => {
    expect(teamHasAnswer(withCell(emptyGrid(), 0, 0, 0, F), 0, 0)).toBe(false)
  })

  it('returns false when only the other team has an answer', () => {
    expect(teamHasAnswer(withCell(emptyGrid(), 2, 0, 0, C), 0, 0)).toBe(false)
  })
})

describe('anyTeamHasAnswer', () => {
  it('returns false for an empty grid', () => {
    expect(anyTeamHasAnswer(emptyGrid(), 0)).toBe(false)
  })

  it('returns true when any team has a non-foul answer', () => {
    const g = withCell(emptyGrid(), 2, 0, 0, Err)
    expect(anyTeamHasAnswer(g, 0)).toBe(true)
  })

  it('returns false when only fouls are present', () => {
    const g = withCell(withCell(emptyGrid(), 0, 0, 0, F), 1, 0, 0, F)
    expect(anyTeamHasAnswer(g, 0)).toBe(false)
  })

  it('checks the correct column', () => {
    const g = withCell(emptyGrid(3), 0, 0, 2, C)
    expect(anyTeamHasAnswer(g, 0)).toBe(false)
    expect(anyTeamHasAnswer(g, 2)).toBe(true)
  })
})

describe('anyTeamHasValue', () => {
  it('returns false when no team has the value', () => {
    expect(anyTeamHasValue(emptyGrid(), 0, C)).toBe(false)
  })

  it('returns true when one team has the value', () => {
    const g = withCell(emptyGrid(), 1, 0, 0, C)
    expect(anyTeamHasValue(g, 0, C)).toBe(true)
  })

  it('distinguishes between value types', () => {
    const g = withCell(emptyGrid(), 0, 0, 0, Err)
    expect(anyTeamHasValue(g, 0, C)).toBe(false)
    expect(anyTeamHasValue(g, 0, Err)).toBe(true)
  })
})

describe('colHasAnyContent', () => {
  it('returns false for an all-empty grid', () => {
    expect(colHasAnyContent(emptyGrid(), 0)).toBe(false)
  })

  it('returns true when any cell is non-empty', () => {
    const g = withCell(emptyGrid(), 1, 0, 0, C)
    expect(colHasAnyContent(g, 0)).toBe(true)
  })

  it('returns true even for Foul (foul is content)', () => {
    const g = withCell(emptyGrid(), 0, 0, 0, F)
    expect(colHasAnyContent(g, 0)).toBe(true)
  })

  it('checks the correct column', () => {
    const g = withCell(emptyGrid(3), 0, 0, 1, C)
    expect(colHasAnyContent(g, 0)).toBe(false)
    expect(colHasAnyContent(g, 1)).toBe(true)
  })
})

describe('isBonusSituation', () => {
  // 3-team quiz: team X is in bonus if the other 2 teams are tossed up on that column.
  it('returns true when all other teams are tossed up', () => {
    const tossedUp = new Set(['1:0', '2:0'])
    expect(isBonusSituation(tossedUp, 0, 0, 3)).toBe(true)
  })

  it('returns false when only one other team is tossed up', () => {
    const tossedUp = new Set(['1:0'])
    expect(isBonusSituation(tossedUp, 0, 0, 3)).toBe(false)
  })

  it('returns false when no other team is tossed up', () => {
    expect(isBonusSituation(new Set(), 0, 0, 3)).toBe(false)
  })

  it('does not count the checked team itself as tossed up', () => {
    // Team 0 tossed up — but we are checking if team 0 is in a bonus situation
    const tossedUp = new Set(['0:0', '1:0'])
    // Team 2 needs to be tossed up for team 0 to be in bonus; only 1 other team is
    expect(isBonusSituation(tossedUp, 0, 0, 3)).toBe(false)
  })

  it('checks the correct column index', () => {
    // Teams 1 and 2 tossed up on col 1, not col 0
    const tossedUp = new Set(['1:1', '2:1'])
    expect(isBonusSituation(tossedUp, 0, 0, 3)).toBe(false)
    expect(isBonusSituation(tossedUp, 0, 1, 3)).toBe(true)
  })

  it('works correctly for team 1 as the bonus team', () => {
    const tossedUp = new Set(['0:0', '2:0'])
    expect(isBonusSituation(tossedUp, 1, 0, 3)).toBe(true)
  })

  it('works correctly for a 2-team quiz', () => {
    const tossedUp = new Set(['1:0'])
    expect(isBonusSituation(tossedUp, 0, 0, 2)).toBe(true)
  })
})
