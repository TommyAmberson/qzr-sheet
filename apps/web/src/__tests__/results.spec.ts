import { describe, it, expect } from 'vitest'
import { CellValue, PlacementFormula, type QuizFile } from '@qzr/shared'
import type { StoredQuiz } from '../api'
import { groupResults } from '../results'

function stored(
  id: number,
  division: string,
  quizNumber: string,
  overrides: Partial<StoredQuiz> = {},
): StoredQuiz {
  const quizFile: QuizFile = {
    version: 2,
    quiz: {
      division,
      quizNumber,
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      questionTypes: [],
    },
    teams: [
      {
        id: 1,
        name: 'Calgary 1',
        onTime: true,
        seatOrder: 0,
        quizzers: [{ id: 11, name: 'Ann', seatOrder: 0 }],
      },
      {
        id: 2,
        name: 'Regina 1',
        onTime: false,
        seatOrder: 1,
        quizzers: [{ id: 21, name: 'Bo', seatOrder: 0 }],
      },
    ],
    answers: [{ quizzerId: 11, columnKey: '1', value: CellValue.Correct }],
    noJumps: [],
  }
  return {
    id,
    roomName: 'Room 1',
    counted: false,
    revision: 1,
    action: 'submitted',
    savedAt: '2026-10-02T10:00:00.000Z',
    savedBy: { name: 'Room 1' },
    quizFile,
    ...overrides,
  }
}

describe('groupResults', () => {
  it('groups quizzes by the division they record, in number order', () => {
    const groups = groupResults([stored(1, '2', '1'), stored(2, '1', '10'), stored(3, '1', '2')])
    expect(groups.map((g) => g.division)).toEqual(['1', '2'])
    expect(groups[0]!.quizzes.map((q) => q.quizNumber)).toEqual(['2', '10'])
  })

  it("keeps a division the meet doesn't list as its own group", () => {
    const groups = groupResults([stored(1, '1', '1'), stored(2, 'Div 1', '2')])
    expect(groups.map((g) => g.division)).toEqual(['1', 'Div 1'])
  })

  it('summarises each quiz with its teams, scores, revision and last save', () => {
    const [row] = groupResults([
      stored(5, '1', '3', { revision: 2, action: 'restored', savedBy: { name: 'Pat' } }),
    ])[0]!.quizzes
    expect(row).toMatchObject({
      id: 5,
      room: 'Room 1',
      revision: 2,
      action: 'restored',
      savedBy: 'Pat',
      counted: false,
    })
    expect(row!.teams.map((t) => [t.name, t.score])).toEqual([
      ['Calgary 1', 40],
      ['Regina 1', 0],
    ])
    // One question answered of fifteen: not placeable yet
    expect(row!.placed).toBe(false)
  })
})
