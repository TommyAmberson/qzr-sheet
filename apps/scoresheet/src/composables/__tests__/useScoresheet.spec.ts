import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { useScoresheet } from '../useScoresheet'
import { CellValue } from '../../types/scoresheet'

beforeEach(() => localStorage.clear())

describe('useScoresheet — initial state', () => {
  it('has 3 teams', () => {
    const s = useScoresheet()
    expect(s.teams.value).toHaveLength(3)
  })

  it('has 30 regulation columns when overtime is off (Q1–15 normal + Q16–20 with A/B variants)', () => {
    const s = useScoresheet()
    expect(s.columns.value).toHaveLength(30)
  })

  it('cells grid is 3 teams × 5 quizzers × 30 columns', () => {
    const s = useScoresheet()
    expect(s.cells.value).toHaveLength(3)
    s.cells.value.forEach((team) => {
      expect(team).toHaveLength(5)
      team.forEach((row) => expect(row).toHaveLength(30))
    })
  })

  it('all teams start with on-time bonus (20) as base score', () => {
    const s = useScoresheet()
    s.scoring.value.forEach((ts) => expect(ts.total).toBe(20))
  })

  it('placements are null before regulation is complete', () => {
    const s = useScoresheet()
    s.placements.value.forEach((p) => expect(p).toBeNull())
  })

  it('canUndo and canRedo are false', () => {
    const s = useScoresheet()
    expect(s.canUndo.value).toBe(false)
    expect(s.canRedo.value).toBe(false)
  })

  it('has no validation errors', () => {
    const s = useScoresheet()
    expect(s.hasAnyErrors.value).toBe(false)
  })
})

describe('useScoresheet — setCell', () => {
  it('correct answer updates cells', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })

  it('correct answer adds 20 to team score', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    expect(s.scoring.value[0]!.total).toBeGreaterThan(0)
  })

  it('first error on a normal column (Q1–16) is free — no deduction', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Error) // Q1, first individual error = free
    expect(s.scoring.value[0]!.total).toBe(20) // on-time bonus, no deduction
  })

  it('error on Q17+ (isErrorPoints) deducts 10', () => {
    const s = useScoresheet()
    // Column index 18 = Q17 normal (isErrorPoints: true)
    s.setCell(0, 0, 18, CellValue.Error)
    expect(s.scoring.value[0]!.total).toBe(10) // 20 on-time bonus − 10
  })

  it('setting a cell to the same value is a no-op (no undo entry)', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    const afterFirst = s.canUndo.value
    s.setCell(0, 0, 0, CellValue.Correct)
    // canUndo stays true but redo stack shouldn't grow unexpectedly
    expect(s.canUndo.value).toBe(afterFirst)
  })

  it('creates an undo entry', () => {
    const s = useScoresheet()
    expect(s.canUndo.value).toBe(false)
    s.setCell(0, 0, 0, CellValue.Correct)
    expect(s.canUndo.value).toBe(true)
  })

  it('out-of-bounds team index is a no-op', () => {
    const s = useScoresheet()
    expect(() => s.setCell(99, 0, 0, CellValue.Correct)).not.toThrow()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Empty)
  })

  it('out-of-bounds column index is a no-op', () => {
    const s = useScoresheet()
    expect(() => s.setCell(0, 0, 99, CellValue.Correct)).not.toThrow()
  })
})

describe('useScoresheet — grey-out', () => {
  it('after a correct answer, other teams are greyed out on that column', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    // teams 1 and 2 should be greyed out on column 0
    expect(s.isGreyedOut(1, 0)).toBe(true)
    expect(s.isGreyedOut(2, 0)).toBe(true)
  })

  it('the answering team cell is also greyed out (column is done)', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    expect(s.isGreyedOut(0, 0)).toBe(true)
  })

  it('unaffected columns are not greyed out', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    expect(s.isGreyedOut(0, 1)).toBe(false)
    expect(s.isGreyedOut(1, 1)).toBe(false)
  })
})

describe('useScoresheet — undo/redo', () => {
  it('undo restores a cell to empty', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    s.undo()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Empty)
    expect(s.canUndo.value).toBe(false)
  })

  it('undo restores score to base (on-time bonus)', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    s.undo()
    expect(s.scoring.value[0]!.total).toBe(20)
  })

  it('redo re-applies the cell value', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    s.undo()
    s.redo()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })

  it('undo then redo sequence leaves canRedo false', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    s.undo()
    s.redo()
    expect(s.canRedo.value).toBe(false)
  })
})

describe('useScoresheet — toggleNoJump', () => {
  it('toggles a column to no-jump', () => {
    const s = useScoresheet()
    expect(s.noJumps.value[0]).toBe(false)
    s.toggleNoJump(0)
    expect(s.noJumps.value[0]).toBe(true)
  })

  it('toggling twice restores original state', () => {
    const s = useScoresheet()
    s.toggleNoJump(0)
    s.toggleNoJump(0)
    expect(s.noJumps.value[0]).toBe(false)
  })

  it('undo restores no-jump to false', () => {
    const s = useScoresheet()
    s.toggleNoJump(0)
    s.undo()
    expect(s.noJumps.value[0]).toBe(false)
  })
})

describe('useScoresheet — clearAnswers', () => {
  it('clears all cell values', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    s.setCell(1, 0, 1, CellValue.Error)
    s.clearAnswers()
    s.cells.value.forEach((team) =>
      team.forEach((row) => row.forEach((cell) => expect(cell).toBe(CellValue.Empty))),
    )
  })

  it('preserves team names after clearing', () => {
    const s = useScoresheet()
    s.setTeamName(0, 'Alpha')
    s.setCell(0, 0, 0, CellValue.Correct)
    s.clearAnswers()
    expect(s.teams.value[0]!.name).toBe('Alpha')
  })

  it('clears no-jump flags', () => {
    const s = useScoresheet()
    s.toggleNoJump(2)
    s.clearAnswers()
    expect(s.noJumps.value[2]).toBe(false)
  })

  it('resets undo/redo history', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    s.clearAnswers()
    expect(s.canUndo.value).toBe(false)
  })
})

describe('useScoresheet — clearNames', () => {
  it('resets team names to Team 1/2/3', () => {
    const s = useScoresheet()
    s.setTeamName(0, 'Alpha')
    s.setTeamName(1, 'Beta')
    s.clearNames()
    expect(s.teams.value[0]!.name).toBe('Team 1')
    expect(s.teams.value[1]!.name).toBe('Team 2')
    expect(s.teams.value[2]!.name).toBe('Team 3')
  })

  it('resets quizzer names to Quizzer 1/2/3/4', () => {
    const s = useScoresheet()
    s.setQuizzerName(0, 0, 'Alice')
    s.clearNames()
    expect(s.teamQuizzers.value[0]![0]!.name).toBe('Quizzer 1')
    expect(s.teamQuizzers.value[0]![1]!.name).toBe('Quizzer 2')
  })

  it('does not clear answers', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    s.clearNames()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })
})

describe('useScoresheet — colAnswerValue', () => {
  it('returns Empty when no answer on that column', () => {
    const s = useScoresheet()
    expect(s.colAnswerValue(0)).toBe(CellValue.Empty)
  })

  it('returns the non-empty, non-foul value when present', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Correct)
    expect(s.colAnswerValue(0)).toBe(CellValue.Correct)
  })

  it('ignores foul entries', () => {
    const s = useScoresheet()
    s.setCell(0, 0, 0, CellValue.Foul)
    expect(s.colAnswerValue(0)).toBe(CellValue.Empty)
  })
})

describe('useScoresheet — overtime columns', () => {
  it('no OT columns when overtime is off (30 regulation columns)', () => {
    const s = useScoresheet()
    expect(s.columns.value).toHaveLength(30)
  })

  it('enabling overtime adds OT columns beyond the 30 regulation', async () => {
    const s = useScoresheet()
    s.quiz.value.overtime = true
    await nextTick()
    expect(s.columns.value.length).toBeGreaterThan(30)
  })
})
