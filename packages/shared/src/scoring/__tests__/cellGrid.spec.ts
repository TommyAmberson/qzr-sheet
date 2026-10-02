import { describe, it, expect } from 'vitest'
import { CellValue } from '../../quizFile'
import { buildColumns } from '../../types/scoresheet'
import { toQuizzerId } from '../../types/indices'
import { TWENTY_QUESTION_RULES } from '../quizRules'
import { answerLookup, buildCellGrid } from '../cellGrid'

const cols = buildColumns(TWENTY_QUESTION_RULES)
const q = (id: number, teamId: number, seatOrder: number) => ({
  id: toQuizzerId(id),
  teamId,
  seatOrder,
})

describe('buildCellGrid', () => {
  it('orders teams and quizzers by seat and fills unanswered cells with Empty', () => {
    const grid = buildCellGrid(
      [
        { id: 2, seatOrder: 1 },
        { id: 1, seatOrder: 0 },
      ],
      [q(11, 1, 1), q(10, 1, 0), q(20, 2, 0)],
      cols,
      answerLookup([
        { quizzerId: toQuizzerId(11), columnKey: '1', value: CellValue.Correct },
        { quizzerId: toQuizzerId(20), columnKey: '2', value: CellValue.Error },
      ]),
    )

    expect(grid).toHaveLength(2)
    expect(grid[0]).toHaveLength(2)
    expect(grid[1]).toHaveLength(1)
    expect(grid[0]![1]![0]).toBe(CellValue.Correct)
    expect(grid[0]![0]![0]).toBe(CellValue.Empty)
    expect(grid[1]![0]![1]).toBe(CellValue.Error)
    expect(grid[1]![0]).toHaveLength(cols.length)
  })

  it('ignores answers for columns it was not given', () => {
    const grid = buildCellGrid(
      [{ id: 1, seatOrder: 0 }],
      [q(10, 1, 0)],
      cols,
      answerLookup([{ quizzerId: toQuizzerId(10), columnKey: '99', value: CellValue.Correct }]),
    )
    expect(grid[0]![0]!.every((v) => v === CellValue.Empty)).toBe(true)
  })
})
