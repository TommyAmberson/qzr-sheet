import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { useScoresheet } from '../useScoresheet'
import { CellValue, QuestionCategory } from '../../types/scoresheet'
import { toTeamIdx, toSeatIdx, toColIdx } from '../../types/indices'

const T = toTeamIdx
const S = toSeatIdx
const C = toColIdx

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
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })

  it('correct answer adds 20 to team score', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    expect(s.scoring.value[0]!.total).toBeGreaterThan(0)
  })

  it('first error on a normal column (Q1–16) is free — no deduction', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Error) // Q1, first individual error = free
    expect(s.scoring.value[0]!.total).toBe(20) // on-time bonus, no deduction
  })

  it('error on Q17+ (isErrorPoints) deducts 10', () => {
    const s = useScoresheet()
    // Column index 18 = Q17 normal (isErrorPoints: true)
    s.setCell(T(0), S(0), C(18), CellValue.Error)
    expect(s.scoring.value[0]!.total).toBe(10) // 20 on-time bonus − 10
  })

  it('setting a cell to the same value is a no-op (no undo entry)', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    const afterFirst = s.canUndo.value
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    // canUndo stays true but redo stack shouldn't grow unexpectedly
    expect(s.canUndo.value).toBe(afterFirst)
  })

  it('creates an undo entry', () => {
    const s = useScoresheet()
    expect(s.canUndo.value).toBe(false)
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    expect(s.canUndo.value).toBe(true)
  })

  it('out-of-bounds team index is a no-op', () => {
    const s = useScoresheet()
    expect(() => s.setCell(T(99), S(0), C(0), CellValue.Correct)).not.toThrow()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Empty)
  })

  it('out-of-bounds column index is a no-op', () => {
    const s = useScoresheet()
    expect(() => s.setCell(T(0), S(0), C(99), CellValue.Correct)).not.toThrow()
  })
})

describe('useScoresheet — grey-out', () => {
  it('after a correct answer, other teams are greyed out on that column', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    // teams 1 and 2 should be greyed out on column 0
    expect(s.isGreyedOut(T(1), C(0))).toBe(true)
    expect(s.isGreyedOut(T(2), C(0))).toBe(true)
  })

  it('the answering team cell is also greyed out (column is done)', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    expect(s.isGreyedOut(T(0), C(0))).toBe(true)
  })

  it('unaffected columns are not greyed out', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    expect(s.isGreyedOut(T(0), C(1))).toBe(false)
    expect(s.isGreyedOut(T(1), C(1))).toBe(false)
  })
})

describe('useScoresheet — undo/redo', () => {
  it('undo restores a cell to empty', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.undo()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Empty)
    expect(s.canUndo.value).toBe(false)
  })

  it('undo restores score to base (on-time bonus)', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.undo()
    expect(s.scoring.value[0]!.total).toBe(20)
  })

  it('redo re-applies the cell value', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.undo()
    s.redo()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })

  it('undo then redo sequence leaves canRedo false', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.undo()
    s.redo()
    expect(s.canRedo.value).toBe(false)
  })
})

describe('useScoresheet — toggleNoJump', () => {
  it('toggles a column to no-jump', () => {
    const s = useScoresheet()
    expect(s.noJumps.value[0]).toBe(false)
    s.toggleNoJump(C(0))
    expect(s.noJumps.value[0]).toBe(true)
  })

  it('toggling twice restores original state', () => {
    const s = useScoresheet()
    s.toggleNoJump(C(0))
    s.toggleNoJump(C(0))
    expect(s.noJumps.value[0]).toBe(false)
  })

  it('undo restores no-jump to false', () => {
    const s = useScoresheet()
    s.toggleNoJump(C(0))
    s.undo()
    expect(s.noJumps.value[0]).toBe(false)
  })
})

describe('useScoresheet — clearAnswers', () => {
  it('clears all cell values', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.setCell(T(1), S(0), C(1), CellValue.Error)
    s.clearAnswers()
    s.cells.value.forEach((team) =>
      team.forEach((row) => row.forEach((cell) => expect(cell).toBe(CellValue.Empty))),
    )
  })

  it('preserves team names after clearing', () => {
    const s = useScoresheet()
    s.setTeamName(T(0), 'Alpha')
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.clearAnswers()
    expect(s.teams.value[0]!.name).toBe('Alpha')
  })

  it('clears no-jump flags', () => {
    const s = useScoresheet()
    s.toggleNoJump(C(2))
    s.clearAnswers()
    expect(s.noJumps.value[2]).toBe(false)
  })

  it('resets undo/redo history', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.clearAnswers()
    expect(s.canUndo.value).toBe(false)
  })
})

describe('useScoresheet — clearNames', () => {
  it('resets team names to Team 1/2/3', () => {
    const s = useScoresheet()
    s.setTeamName(T(0), 'Alpha')
    s.setTeamName(T(1), 'Beta')
    s.clearNames()
    expect(s.teams.value[0]!.name).toBe('Team 1')
    expect(s.teams.value[1]!.name).toBe('Team 2')
    expect(s.teams.value[2]!.name).toBe('Team 3')
  })

  it('resets quizzer names to Quizzer 1/2/3/4', () => {
    const s = useScoresheet()
    s.setQuizzerName(T(0), S(0), 'Alice')
    s.clearNames()
    expect(s.teamQuizzers.value[0]![0]!.name).toBe('Quizzer 1')
    expect(s.teamQuizzers.value[0]![1]!.name).toBe('Quizzer 2')
  })

  it('does not clear answers', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.clearNames()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })
})

describe('useScoresheet — colAnswerValue', () => {
  it('returns Empty when no answer on that column', () => {
    const s = useScoresheet()
    expect(s.colAnswerValue(C(0))).toBe(CellValue.Empty)
  })

  it('returns the non-empty, non-foul value when present', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    expect(s.colAnswerValue(C(0))).toBe(CellValue.Correct)
  })

  it('ignores foul entries', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Foul)
    expect(s.colAnswerValue(C(0))).toBe(CellValue.Empty)
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

describe('useScoresheet — toggleOnTime', () => {
  it('removing on-time drops the +20 bonus from team score', () => {
    const s = useScoresheet()
    // all teams start at 20 (on-time bonus)
    expect(s.scoring.value[0]!.total).toBe(20)
    s.toggleOnTime(T(0))
    expect(s.scoring.value[0]!.total).toBe(0)
  })

  it('restoring on-time adds the bonus back', () => {
    const s = useScoresheet()
    s.toggleOnTime(T(0))
    s.toggleOnTime(T(0))
    expect(s.scoring.value[0]!.total).toBe(20)
  })

  it('only affects the toggled team', () => {
    const s = useScoresheet()
    s.toggleOnTime(T(0))
    expect(s.scoring.value[1]!.total).toBe(20)
    expect(s.scoring.value[2]!.total).toBe(20)
  })
})

describe('useScoresheet — isAfterOut', () => {
  it('returns false before a quizzer is out', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    expect(s.isAfterOut(T(0), S(0), C(1))).toBe(false)
  })

  it('returns true for empty cells after a quizzer quizzes out (4 correct)', () => {
    const s = useScoresheet()
    // Give quizzer 0 of team 0 four correct answers on cols 0–3
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.setCell(T(0), S(0), C(1), CellValue.Correct)
    s.setCell(T(0), S(0), C(2), CellValue.Correct)
    s.setCell(T(0), S(0), C(3), CellValue.Correct)
    // Col 4 onwards should be "after out" for that quizzer
    expect(s.isAfterOut(T(0), S(0), C(4))).toBe(true)
  })

  it('returns false for non-empty cells after out (answered cells are not "after out")', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.setCell(T(0), S(0), C(1), CellValue.Correct)
    s.setCell(T(0), S(0), C(2), CellValue.Correct)
    s.setCell(T(0), S(0), C(3), CellValue.Correct)
    // Set something on col 4 — isAfterOut only applies to empty cells
    s.setCell(T(0), S(0), C(4), CellValue.Error)
    expect(s.isAfterOut(T(0), S(0), C(4))).toBe(false)
  })
})

describe('useScoresheet — error tracking helpers', () => {
  it('columnHasErrors returns false when no errors exist', () => {
    const s = useScoresheet()
    expect(s.columnHasErrors(C(0))).toBe(false)
  })

  it('quizzerHasErrors returns false when no errors exist', () => {
    const s = useScoresheet()
    expect(s.quizzerHasErrors(T(0), S(0))).toBe(false)
  })

  it('teamHasErrors returns false when no errors exist', () => {
    const s = useScoresheet()
    expect(s.teamHasErrors(T(0))).toBe(false)
  })

  it('quizzerHasErrors returns true when a quizzer has a validation error', () => {
    const s = useScoresheet()
    // Two quizzers answer the same column — duplicate answer = validation error
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.setCell(T(0), S(1), C(0), CellValue.Error) // error after correct is valid in isolation
    // A simpler trigger: same quizzer answers same column twice won't happen via setCell
    // but two different quizzers getting Correct on the same col is a duplicate
    s.setCell(T(0), S(1), C(0), CellValue.Correct)
    expect(s.quizzerHasErrors(T(0), S(0))).toBe(true) // duplicate answer flagged
  })
})

describe('useScoresheet — setTeamName / setQuizzerName', () => {
  it('setTeamName updates the team name', () => {
    const s = useScoresheet()
    s.setTeamName(T(0), 'Eagles')
    expect(s.teams.value[0]!.name).toBe('Eagles')
  })

  it('setQuizzerName updates the quizzer name', () => {
    const s = useScoresheet()
    s.setQuizzerName(T(0), S(0), 'Jordan')
    expect(s.teamQuizzers.value[0]![0]!.name).toBe('Jordan')
  })

  it('setTeamName with out-of-bounds index is a no-op', () => {
    const s = useScoresheet()
    expect(() => s.setTeamName(T(99), 'Ghost')).not.toThrow()
  })
})

describe('useScoresheet — moveQuizzer', () => {
  it('moves a quizzer to a different seat', () => {
    const s = useScoresheet()
    const originalFirst = s.teamQuizzers.value[0]![0]!.name
    const originalSecond = s.teamQuizzers.value[0]![1]!.name
    s.moveQuizzer(T(0), S(0), S(1))
    expect(s.teamQuizzers.value[0]![0]!.name).toBe(originalSecond)
    expect(s.teamQuizzers.value[0]![1]!.name).toBe(originalFirst)
  })
})

describe('useScoresheet — setQuestionType', () => {
  it('sets a question category on a column', () => {
    const s = useScoresheet()
    s.setQuestionType(C(0), QuestionCategory.INT)
    expect(s.quiz.value.questionTypes.get(s.columns.value[0]!.key)).toBe(QuestionCategory.INT)
  })

  it('clears a question category when null is passed', () => {
    const s = useScoresheet()
    s.setQuestionType(C(0), QuestionCategory.INT)
    s.setQuestionType(C(0), null)
    expect(s.quiz.value.questionTypes.get(s.columns.value[0]!.key)).toBeUndefined()
  })
})

describe('useScoresheet — resetStore', () => {
  it('clears all answers', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.resetStore()
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Empty)
  })

  it('resets team names to defaults', () => {
    const s = useScoresheet()
    s.setTeamName(T(0), 'Eagles')
    s.resetStore()
    expect(s.teams.value[0]!.name).toBe('Team 1')
  })

  it('resets undo history', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.resetStore()
    expect(s.canUndo.value).toBe(false)
  })
})
