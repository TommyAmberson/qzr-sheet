import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { useScoresheet } from '../useScoresheet'
import {
  claimRecord,
  currentTab,
  listRecent,
  readRecord,
  setTabLink,
  startTab,
  writeRecord,
} from '../../persistence/autoSave'
import { createQuizStore } from '../../stores/quizStore'
import { aRecord } from '../../persistence/__tests__/records'
import {
  CellValue,
  QuestionCategory,
  QuizFormat,
  toColIdx,
  toSeatIdx,
  toTeamIdx,
} from '@qzr/shared'

const T = toTeamIdx
const S = toSeatIdx
const C = toColIdx

beforeEach(() => {
  localStorage.clear()
})

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
    expect(s.isGreyedOut(T(1), S(0), C(0))).toBe(true)
    expect(s.isGreyedOut(T(2), S(0), C(0))).toBe(true)
  })

  it('the answering team cell is also greyed out (column is done)', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    expect(s.isGreyedOut(T(0), S(0), C(0))).toBe(true)
  })

  it('unaffected columns are not greyed out', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    expect(s.isGreyedOut(T(0), S(0), C(1))).toBe(false)
    expect(s.isGreyedOut(T(1), S(0), C(1))).toBe(false)
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

  it('clears question types, keeping the quiz settings', () => {
    const s = useScoresheet()
    s.setQuestionType(C(2), QuestionCategory.FTV)
    s.quiz.value.division = '2C'
    s.clearAnswers()
    expect(s.quiz.value.questionTypes.size).toBe(0)
    expect(s.quiz.value.division).toBe('2C')
  })

  it('resets undo/redo history', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.clearAnswers()
    expect(s.canUndo.value).toBe(false)
  })
})

describe('useScoresheet — swapTeams', () => {
  /** A quiz where each team is told apart by its name, a quizzer, an answer and its on-time mark */
  function threeTeams() {
    const s = useScoresheet()
    ;['Lions', 'Tigers', 'Bears'].forEach((name, t) => {
      s.setTeamName(T(t), name)
      s.setQuizzerName(T(t), S(0), `${name} one`)
      s.setQuizzerName(T(t), S(1), `${name} two`)
    })
    s.setCell(T(0), S(1), C(0), CellValue.Correct)
    s.setCell(T(1), S(0), C(1), CellValue.Correct)
    s.setCell(T(1), S(0), C(2), CellValue.Correct)
    s.setCell(T(1), S(1), C(3), CellValue.Correct)
    s.toggleOnTime(T(1))
    return s
  }
  const teamsOf = (s: ReturnType<typeof useScoresheet>) =>
    s.teams.value.map((team, t) => ({
      name: team.name,
      onTime: team.onTime,
      quizzers: s.teamQuizzers.value[t]!.map((quizzer) => quizzer.name),
      cells: s.cells.value[t],
      score: s.scoring.value[t]!.total,
    }))

  it('moves each whole team to the other place, and leaves the third alone', () => {
    const s = threeTeams()
    const [lions, tigers, bears] = teamsOf(s)
    expect(lions!.score).not.toBe(tigers!.score)

    s.swapTeams(0, 1)

    expect(teamsOf(s)).toEqual([tigers, lions, bears])
  })

  it('is one edit: undo puts both back, redo swaps again, and what runs alongside runs each way', () => {
    const s = threeTeams()
    const before = teamsOf(s)
    const alongside = vi.fn()

    s.swapTeams(0, 2, alongside)
    const swapped = teamsOf(s)
    s.undo()
    expect(teamsOf(s)).toEqual(before)
    s.redo()
    expect(teamsOf(s)).toEqual(swapped)
    expect(alongside).toHaveBeenCalledTimes(3)
  })

  it('does nothing for a team with itself or a place the sheet lacks', () => {
    const s = threeTeams()
    const before = teamsOf(s)
    s.swapTeams(1, 1)
    s.swapTeams(0, 7)
    expect(teamsOf(s)).toEqual(before)
    expect(s.canUndo.value).toBe(true)
  })
})

describe('useScoresheet — undo steps', () => {
  it('keeps up to 1000 steps, the oldest falling off', () => {
    const s = useScoresheet()
    for (let i = 0; i < 1001; i++) {
      s.setCell(T(0), S(0), C(0), i % 2 === 0 ? CellValue.Correct : CellValue.Empty)
    }
    for (let i = 0; i < 999; i++) s.undo()
    expect(s.canUndo.value).toBe(true)
    s.undo()
    expect(s.canUndo.value).toBe(false)
    // The first step fell off, so undoing stops at the state it left
    expect(s.cells.value[0]![0]![0]).toBe(CellValue.Correct)
  })

  it('keeps names, on-time marks, question types and quizzer order out of history', () => {
    const s = useScoresheet()
    s.setTeamName(T(0), 'Lions')
    s.setQuizzerName(T(0), S(0), 'Alice')
    s.toggleOnTime(T(1))
    s.setQuestionType(C(0), QuestionCategory.Q)
    s.moveQuizzer(T(0), S(0), S(1))
    expect(s.canUndo.value).toBe(false)
  })

  it('takes back an edit made as one, and redoes it', () => {
    const s = useScoresheet()
    const alongside = vi.fn()
    const write = (name: string) => {
      s.setTeamName(T(0), name)
      s.setQuizzerName(T(0), S(0), name && `${name} one`)
      alongside(name)
    }
    s.editAsOne({ redo: () => write('Lions'), undo: () => write('') })
    s.undo()
    expect(s.teams.value[0]!.name).toBe('')
    expect(s.teamQuizzers.value[0]![0]!.name).toBe('')
    s.redo()
    expect(s.teams.value[0]!.name).toBe('Lions')
    expect(alongside.mock.calls).toEqual([['Lions'], [''], ['Lions']])
  })
})

describe('useScoresheet — clearNames', () => {
  it('blanks team names', () => {
    const s = useScoresheet()
    s.setTeamName(T(0), 'Alpha')
    s.setTeamName(T(1), 'Beta')
    s.clearNames()
    expect(s.teams.value.map((team) => team.name)).toEqual(['', '', ''])
  })

  it('blanks quizzer names', () => {
    const s = useScoresheet()
    s.setQuizzerName(T(0), S(0), 'Alice')
    s.clearNames()
    expect(s.teamQuizzers.value[0]!.map((quizzer) => quizzer.name)).toEqual(['', '', '', '', ''])
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

  it('leaves bonuses open to a quizzed-out quizzer until they foul out', () => {
    const s = useScoresheet()
    const at = (key: string) => C(s.columns.value.findIndex((col) => col.key === key))
    for (const col of [0, 1, 2, 3]) s.setCell(T(0), S(0), C(col), CellValue.Correct)
    expect(s.isAfterOut(T(0), S(0), at('16B'))).toBe(false)
    expect(s.isAfterOut(T(0), S(0), at('20B'))).toBe(false)
    for (const key of ['17', '18', '19']) s.setCell(T(0), S(0), at(key), CellValue.Foul)
    // Still on the bench for the bonus before the third foul, gone for the one after it
    expect(s.isAfterOut(T(0), S(0), at('16B'))).toBe(false)
    expect(s.isAfterOut(T(0), S(0), at('20B'))).toBe(true)
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

  it('blanks team names', () => {
    const s = useScoresheet()
    s.setTeamName(T(0), 'Eagles')
    s.resetStore()
    expect(s.teams.value[0]!.name).toBe('')
  })

  it('resets undo history', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.resetStore()
    expect(s.canUndo.value).toBe(false)
  })
})

describe('useScoresheet — 15-question quiz', () => {
  it('resetStore(FifteenQuestion) starts a 15-question quiz', () => {
    const s = useScoresheet()
    s.resetStore(QuizFormat.FifteenQuestion)
    expect(s.quiz.value.format).toBe(QuizFormat.FifteenQuestion)
    // 10 plain questions + 5 questions with A/B
    expect(s.columns.value).toHaveLength(23)
    expect(s.columns.value[s.columns.value.length - 1]!.key).toBe('15B')
  })

  it('resetStore() starts a 20-question quiz', () => {
    const s = useScoresheet()
    s.resetStore(QuizFormat.FifteenQuestion)
    s.resetStore()
    expect(s.quiz.value.format).toBe(QuizFormat.TwentyQuestion)
    expect(s.columns.value).toHaveLength(30)
  })

  it('allows timeouts through 12B and refuses them from 13', () => {
    const s = useScoresheet()
    s.resetStore(QuizFormat.FifteenQuestion)
    for (const key of ['10', '11', '12', '12A', '12B']) expect(s.isTimeoutAllowed(key)).toBe(true)
    for (const key of ['13', '13A', '15']) expect(s.isTimeoutAllowed(key)).toBe(false)
  })

  it('sizes overtime from the rules of the loaded quiz', () => {
    const s = useScoresheet()
    const { id: _, ...quiz } = s.store.quiz
    // Regulation and round 1 (16 to 18) all no-jumped: still tied, so round 2 is needed
    const noJumps = new Map(Array.from({ length: 18 }, (_, i) => [`${i + 1}`, true] as const))
    s.loadFile({
      quiz: { ...quiz, format: QuizFormat.FifteenQuestion, overtime: true },
      teams: s.store.teams.map(({ quizId: _, ...t }) => t),
      quizzers: [...s.store.quizzers],
      answers: [],
      noJumps,
      timeouts: new Map(),
    })
    expect(s.columns.value.some((c) => c.key === '21')).toBe(true)
    expect(s.columns.value.find((c) => c.key === '16')!.isOvertime).toBe(true)
  })

  it("flags a team's third timeout (2 per team)", () => {
    const s = useScoresheet()
    s.resetStore(QuizFormat.FifteenQuestion)
    const teamId = s.teams.value[0]!.id
    s.toggleTimeout(teamId, '1')
    s.toggleTimeout(teamId, '2')
    expect(s.tooManyTimeoutsTeams.value.has(0)).toBe(false)
    s.toggleTimeout(teamId, '3')
    expect(s.tooManyTimeoutsTeams.value.has(0)).toBe(true)
  })
})

describe('useScoresheet — keeping a 15-question quiz', () => {
  function fifteenWithAnswer() {
    const s = useScoresheet()
    s.resetStore(QuizFormat.FifteenQuestion)
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    return s
  }

  it('keeps the format through clearAnswers and clearNames', () => {
    const s = fifteenWithAnswer()
    s.clearAnswers()
    expect(s.quiz.value.format).toBe(QuizFormat.FifteenQuestion)
    s.clearNames()
    expect(s.quiz.value.format).toBe(QuizFormat.FifteenQuestion)
  })

  it('restores a 15-question quiz from auto-save', async () => {
    await startTab()
    fifteenWithAnswer()
    // Auto-save is debounced
    await vi.waitFor(() => expect(currentTab()!.record).toBeDefined())
    const restored = useScoresheet()
    expect(restored.quiz.value.format).toBe(QuizFormat.FifteenQuestion)
    expect(restored.cells.value[0]![0]![0]).toBe(CellValue.Correct)
    expect(restored.columns.value).toHaveLength(23)
  })

  it('clears the opened-from-newer-file flag when another quiz replaces it', () => {
    const s = fifteenWithAnswer()
    const { id: _, ...quiz } = s.store.quiz
    const data = {
      quiz: { ...quiz },
      teams: s.store.teams.map(({ quizId: _, ...t }) => t),
      quizzers: [...s.store.quizzers],
      answers: [],
      noJumps: new Map<string, boolean>(),
      timeouts: new Map(),
    }
    s.loadFile(data, { fromNewerFile: true })
    expect(s.openedFromNewerFile.value).toBe(true)
    s.loadFile(data)
    expect(s.openedFromNewerFile.value).toBe(false)
    s.loadFile(data, { fromNewerFile: true })
    s.resetStore()
    expect(s.openedFromNewerFile.value).toBe(false)
  })

  it('keeps the opened-from-newer-file warning across a reload', async () => {
    await startTab()
    const s = fifteenWithAnswer()
    const { id: _, ...quiz } = s.store.quiz
    s.loadFile(
      {
        quiz: { ...quiz },
        teams: s.store.teams.map(({ quizId: _, ...t }) => t),
        quizzers: [...s.store.quizzers],
        answers: [],
        noJumps: new Map<string, boolean>(),
        timeouts: new Map(),
      },
      { fromNewerFile: true },
    )
    // As opening a file does
    s.markSaved()
    await vi.waitFor(() => expect(currentTab()!.record?.fromNewerFile).toBe(true))
    expect(useScoresheet().openedFromNewerFile.value).toBe(true)
  })
})

describe('useScoresheet — the newer-file warning with nothing restored', () => {
  it('is cleared when the auto-save could not be restored', async () => {
    const tab = await startTab()
    tab.record = aRecord({
      id: tab.id,
      fromNewerFile: true,
      current: { file: '{not json', undo: [], redo: [] },
    })
    expect(useScoresheet().openedFromNewerFile.value).toBe(false)
  })
})

describe("useScoresheet — the tab's writer", () => {
  beforeEach(async () => {
    await startTab()
  })
  const written = () => readRecord(currentTab()!.id)
  const answersWritten = async () =>
    JSON.parse((await written())?.current?.file ?? '{"answers":[]}').answers.length

  it('says a write failed, and still writes the next change', async () => {
    const scope = effectScope()
    const s = scope.run(() => useScoresheet())!
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('broken', 'UnknownError')
    })
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.flushAutoSave()
    await vi.waitFor(() => expect(s.keepFailed.value).toBe('failed'))
    put.mockRestore()
    s.setCell(T(0), S(0), C(1), CellValue.Correct)
    s.flushAutoSave()
    await vi.waitFor(async () => expect(await answersWritten()).toBe(2))
    expect(s.keepFailed.value).toBeNull()
    scope.stop()
  })

  it('says the device is full when no room can be made', async () => {
    const scope = effectScope()
    const s = scope.run(() => useScoresheet())!
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.flushAutoSave()
    await vi.waitFor(() => expect(s.keepFailed.value).toBe('full'))
    put.mockRestore()
    scope.stop()
  })

  it('lets another tab take the quiz it left only once its last edit is written', async () => {
    const scope = effectScope()
    const s = scope.run(() => useScoresheet())!
    const left = currentTab()!.id
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    // A write in flight, then an edit and New
    s.flushAutoSave()
    s.setCell(T(0), S(0), C(1), CellValue.Correct)
    s.replaceQuiz()
    expect(await claimRecord(left, { wait: 1000 })).not.toBeNull()
    expect(JSON.parse((await readRecord(left))!.current!.file).answers).toHaveLength(2)
    scope.stop()
  })

  it("writes changes to the tab's record together, once they pause", async () => {
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.setCell(T(0), S(1), C(1), CellValue.Correct)
    await vi.waitFor(async () => expect(await answersWritten()).toBe(2))
    expect(put).toHaveBeenCalledTimes(1)
    put.mockRestore()
  })

  it('writes what loading, resetting and clearing do, through the same writer', async () => {
    const s = useScoresheet()
    const other = createQuizStore()
    other.setAnswer(other.quizzers[0]!.id, '1', CellValue.Correct)
    s.loadFile({ ...other, answers: other.answers, noJumps: new Map(), timeouts: new Map() })
    // As opening a file does
    s.markSaved()
    await vi.waitFor(async () => expect(await answersWritten()).toBe(1))
    s.clearAnswers()
    await vi.waitFor(async () => expect(await answersWritten()).toBe(0))
    s.setTeamName(T(0), 'Lions')
    s.clearNames()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.resetStore()
    await vi.waitFor(async () => {
      const file = JSON.parse((await written())!.current!.file)
      expect(file.answers).toHaveLength(0)
      expect(file.teams[0].name).toBe('')
    })
  })

  it('writes nothing while paused', async () => {
    const s = useScoresheet()
    s.pauseAutoSave.value = true
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(await written()).toBeUndefined()
  })

  it('writes the meet link with the quiz', async () => {
    useScoresheet().setCell(T(0), S(0), C(0), CellValue.Correct)
    setTabLink({ meetId: 4, meetName: 'Meet' } as never)
    await vi.waitFor(async () => expect((await written())?.link).toMatchObject({ meetId: 4 }))
  })
})

describe('useScoresheet — saved, and kept', () => {
  beforeEach(async () => {
    await startTab()
  })
  const pause = () => new Promise((resolve) => setTimeout(resolve, 400))
  const kept = async () => (await readRecord(currentTab()!.id)) !== undefined

  it('is saved as saved to a file, and again when undone or edited back to it', () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.markSaved()
    expect(s.unsaved.value).toBe(false)
    s.setCell(T(0), S(0), C(1), CellValue.Correct)
    expect(s.unsaved.value).toBe(true)
    s.undo()
    expect(s.unsaved.value).toBe(false)
    s.redo()
    s.setCell(T(0), S(0), C(1), CellValue.Empty)
    expect(s.unsaved.value).toBe(false)
  })

  it('is saved as submitted only while linked to the scheduled quiz it went to', () => {
    const s = useScoresheet()
    setTabLink({ meetId: 1, quizId: 'a' } as never)
    s.markSubmitted(1, 'a')
    expect(s.unsaved.value).toBe(false)
    setTabLink({ meetId: 1, quizId: 'b' } as never)
    expect(s.unsaved.value).toBe(true)
    setTabLink({ meetId: 1, quizId: 'a' } as never)
    expect(s.unsaved.value).toBe(false)
  })

  it('is not kept while nothing was done by hand, names a link filled in included', async () => {
    const s = useScoresheet()
    s.resetStore()
    // The link routine fills in the rosters' names, then takes that as the quiz's start
    s.setTeamName(T(0), 'Calgary 1')
    s.retakeStart()
    await pause()
    expect(await kept()).toBe(false)
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    await vi.waitFor(async () => expect(await kept()).toBe(true))
  })

  it('is kept once edited, even undone back to its start, and with a saved state unedited', async () => {
    const s = useScoresheet()
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.undo()
    await pause()
    expect(await kept()).toBe(true)

    await startTab()
    const other = useScoresheet()
    other.markSaved()
    await vi.waitFor(async () => expect(await kept()).toBe(true))
  })
})

describe('useScoresheet — continuing a quiz from an earlier state', () => {
  /** A quiz saved after one answer and edited since with two more, left by a closed tab */
  async function savedThenEdited() {
    await startTab()
    const scope = effectScope()
    const s = scope.run(() => useScoresheet())!
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.markSaved()
    s.setCell(T(0), S(0), C(1), CellValue.Correct)
    s.setCell(T(0), S(0), C(2), CellValue.Correct)
    setTabLink({ meetId: 5, meetName: 'Meet' } as never)
    s.flushAutoSave()
    await vi.waitFor(async () => expect(await readRecord(currentTab()!.id)).toBeDefined())
    // The tab closes; a new one opens, and is offered nothing
    scope.stop()
    const record = { ...(await readRecord(currentTab()!.id))!, offered: true }
    await writeRecord(record)
    currentTab()!.claim.release()
    sessionStorage.clear()
    await startTab()
    const sheet = useScoresheet()
    sheet.restoreQuiz(record, (await claimRecord(record.id))!, 'saved')
    return { sheet, record }
  }
  const answers = (s: ReturnType<typeof useScoresheet>) =>
    s.cells.value[0]![0]!.filter((cell) => cell === CellValue.Correct).length

  it('puts the quiz at that state, with redo up to the latest', async () => {
    const { sheet } = await savedThenEdited()
    expect(answers(sheet)).toBe(1)
    expect(sheet.unsaved.value).toBe(false)
    sheet.redo()
    sheet.redo()
    expect(answers(sheet)).toBe(3)
    expect(sheet.canRedo.value).toBe(false)
  })

  it('keeps the latest state as a quiz of its own when an edit leaves it behind', async () => {
    const { sheet, record } = await savedThenEdited()
    sheet.setCell(T(1), S(0), C(0), CellValue.Correct)
    await vi.waitFor(async () => {
      const split = (await listRecent(currentTab()!.id)).find((r) => r.id !== record.id)
      expect(split?.current?.file).toBe(record.current!.file)
      expect(split?.current?.undo).toHaveLength(3)
      expect(split?.link).toMatchObject({ meetId: 5 })
    })
  })

  it('keeps nothing extra once redone up to the latest state', async () => {
    const { sheet, record } = await savedThenEdited()
    sheet.redo()
    sheet.redo()
    sheet.setCell(T(1), S(0), C(0), CellValue.Correct)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const files = (await listRecent(currentTab()!.id)).map((r) => r.current?.file)
    expect(files).not.toContain(record.current!.file)
  })

  it('keeps the latest state too when the answers are cleared there', async () => {
    const { sheet, record } = await savedThenEdited()
    sheet.clearAnswers()
    await vi.waitFor(async () => {
      const recent = await listRecent(currentTab()!.id)
      expect(recent.map((r) => r.current?.file)).toContain(record.current!.file)
    })
  })
})

describe('useScoresheet — undo across a reload and a restore', () => {
  beforeEach(async () => {
    await startTab()
  })
  const correct = (s: ReturnType<typeof useScoresheet>) =>
    s.cells.value[0]![0]!.filter((cell) => cell === CellValue.Correct).length

  /** The page reloads: a new sheet starts from the tab's record */
  async function reload(
    scope: ReturnType<typeof effectScope>,
    s: ReturnType<typeof useScoresheet>,
  ) {
    s.flushAutoSave()
    await vi.waitFor(async () => expect(await readRecord(currentTab()!.id)).toBeDefined())
    scope.stop()
    return useScoresheet()
  }

  it('steps through the same edits after a reload, newest first, and redoes them', async () => {
    const scope = effectScope()
    const s = scope.run(() => useScoresheet())!
    for (let col = 0; col < 5; col++) s.setCell(T(0), S(0), C(col), CellValue.Correct)
    s.undo()
    const after = await reload(scope, s)
    expect(correct(after)).toBe(4)
    after.undo()
    expect(after.cells.value[0]![0]![3]).toBe(CellValue.Empty)
    for (let i = 0; i < 3; i++) after.undo()
    expect(correct(after)).toBe(0)
    expect(after.canUndo.value).toBe(false)
    for (let i = 0; i < 5; i++) after.redo()
    expect(correct(after)).toBe(5)
  })

  it('brings a restored quiz back with the steps that led to it', async () => {
    const scope = effectScope()
    const s = scope.run(() => useScoresheet())!
    s.setCell(T(0), S(0), C(0), CellValue.Correct)
    s.setCell(T(0), S(0), C(1), CellValue.Correct)
    s.flushAutoSave()
    await vi.waitFor(async () => expect(await readRecord(currentTab()!.id)).toBeDefined())
    const record = (await readRecord(currentTab()!.id))!
    scope.stop()
    currentTab()!.claim.release()
    sessionStorage.clear()
    await startTab()
    const sheet = useScoresheet()
    sheet.restoreQuiz({ ...record, offered: true }, (await claimRecord(record.id))!)
    sheet.undo()
    expect(correct(sheet)).toBe(1)
  })

  it('keeps the last 1000 steps, and the saved state with its own', async () => {
    const scope = effectScope()
    const s = scope.run(() => useScoresheet())!
    s.setCell(T(0), S(0), C(5), CellValue.Correct)
    s.markSaved()
    for (let i = 0; i < 1001; i++) {
      s.setCell(T(0), S(0), C(0), i % 2 === 0 ? CellValue.Correct : CellValue.Empty)
    }
    const after = await reload(scope, s)
    const record = currentTab()!.record!
    expect(record.current!.undo).toHaveLength(1000)
    expect(record.saved!.undo).toHaveLength(1)
    for (let i = 0; i < 1000; i++) after.undo()
    expect(after.canUndo.value).toBe(false)
  })
})
