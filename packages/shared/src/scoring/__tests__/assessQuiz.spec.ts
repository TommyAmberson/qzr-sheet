import { describe, it, expect } from 'vitest'
import { BonusRule, CellValue, PlacementFormula } from '../../quizFile'
import { assessQuiz, isTimeoutAllowed, type QuizAssessmentInput } from '../assessQuiz'
import { RULES, cols, buildCells } from './fixtures/fifteenQuestionQuiz'

function input(overrides: Partial<QuizAssessmentInput> = {}): QuizAssessmentInput {
  return {
    cells: buildCells(),
    columns: cols,
    rules: RULES,
    noJumps: cols.map(() => false),
    onTimes: [true, true, true],
    overtime: false,
    bonusRule: BonusRule.Seat,
    placementFormula: PlacementFormula.Rules,
    emptySeats: new Set(),
    timeouts: [[], [], []],
    ...overrides,
  }
}

describe('assessQuiz', () => {
  it('places the hand-scored 15-question quiz as scored by hand', () => {
    const result = assessQuiz(input())
    expect(result.hasErrors).toBe(false)
    expect(result.placements).toEqual([1, 3, 2])
    expect(result.placementPoints).toEqual([20, 1, 9])
  })

  it('places nobody until every regulation question is answered or no-jumped', () => {
    const cells = buildCells()
    const last = cols.findIndex((c) => c.key === '15')
    for (const team of cells) for (const seat of team) seat[last] = CellValue.Empty
    const result = assessQuiz(input({ cells }))
    expect(result.placements).toEqual([null, null, null])
    expect(result.placementPoints).toEqual([null, null, null])
  })

  it('places nobody while a timeout follows the start of error points', () => {
    const result = assessQuiz(input({ timeouts: [[], [{ afterColumnKey: '13' }], []] }))
    expect(result.hasErrors).toBe(true)
    expect(result.timeoutErrorsByTeam.get(1)).toEqual(
      new Set([cols.findIndex((c) => c.key === '13')]),
    )
    expect(result.placements).toEqual([null, null, null])
  })

  it('flags a team with more timeouts than allowed', () => {
    const three = [{ afterColumnKey: '1' }, { afterColumnKey: '2' }, { afterColumnKey: '3' }]
    const result = assessQuiz(input({ timeouts: [three, [], []] }))
    expect(result.tooManyTimeoutsTeams).toEqual(new Set([0]))
    expect(result.hasErrors).toBe(true)
  })
})

describe('isTimeoutAllowed', () => {
  it('allows timeouts until error points begin and not after', () => {
    expect(isTimeoutAllowed('12', RULES)).toBe(true)
    expect(isTimeoutAllowed('13', RULES)).toBe(false)
    expect(isTimeoutAllowed('12A', RULES)).toBe(true)
  })
})
