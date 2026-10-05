import { describe, it, expect } from 'vitest'
import { CellValue, PlacementFormula, type QuizFile } from '@qzr/shared'
import type { StoredQuiz } from '../api'
import { countedQuizzes, editQuizFile, groupResults, mergeEdits } from '../results'

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
    origin: { action: 'submitted', name: 'Room 1' },
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
    expect(groups[0]!.quizzes.map((q) => q.name)).toEqual(['D1 Q2', 'D1 Q10'])
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
      name: 'D1 Q3',
      from: 'Room 1',
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

  it('says who uploaded a quiz, and keeps consolation quizzes apart', () => {
    const consolation = stored(2, '1', '3')
    consolation.quizFile.quiz.consolation = true
    const [group] = groupResults([
      consolation,
      stored(1, '1', '3', { origin: { action: 'uploaded', name: 'Pat' } }),
    ])
    expect(group!.quizzes.map((q) => [q.name, q.from])).toEqual([
      ['D1 Q3', 'Uploaded by Pat'],
      ['D1c Q3', 'Room 1'],
    ])
  })
})

describe('countedQuizzes', () => {
  it("gives a division's standings only its counted quizzes, with their outcomes", () => {
    const [division] = groupResults([
      stored(1, '1', '1', { counted: true }),
      stored(2, '1', '2'),
      stored(3, '1', '3', { counted: true }),
    ])
    const counted = countedQuizzes(division!)
    expect(counted.map((q) => q.name)).toEqual(['D1 Q1', 'D1 Q3'])
    expect(counted[0]!.outcome).toEqual({
      placed: division!.quizzes[0]!.placed,
      teams: division!.quizzes[0]!.teams,
    })
  })
})

describe('editQuizFile', () => {
  it('changes names, division and quiz number, and keeps the answers', () => {
    const { quizFile } = stored(1, '1', '3')
    const edited = editQuizFile(quizFile, {
      division: ' 2 ',
      quizNumber: '4',
      teamNames: new Map([[1, 'Calgary 2']]),
      quizzerNames: new Map([[21, 'Bea']]),
    })
    expect(edited.quiz).toMatchObject({ division: '2', quizNumber: '4' })
    expect(edited.teams.map((t) => t.name)).toEqual(['Calgary 2', 'Regina 1'])
    expect(edited.teams[1]!.quizzers.map((q) => q.name)).toEqual(['Bea'])
    expect(edited.answers).toEqual(quizFile.answers)
  })
})

describe('mergeEdits', () => {
  /** A stored quiz with its first team renamed */
  function named(id: number, division: string, name: string): StoredQuiz {
    const quiz = stored(id, division, String(id))
    const teams = quiz.quizFile.teams.map((team, i) => (i === 0 ? { ...team, name } : team))
    return { ...quiz, quizFile: { ...quiz.quizFile, teams } }
  }

  it("renames the merged name in each of the division's quizzes using it, however it is cased", () => {
    const quizzes = [
      named(1, '1', 'Calgry 1'),
      named(2, '1', ' calgry  1'),
      named(3, '1', 'Calgary 1'),
    ]
    const edits = mergeEdits(quizzes, '1', 'Calgry 1', 'Calgary 1')
    expect(edits.map((edit) => edit.id)).toEqual([1, 2])
    for (const { quizFile } of edits) {
      expect(quizFile.teams.map((t) => t.name)).toEqual(['Calgary 1', 'Regina 1'])
      expect(quizFile.quiz).toMatchObject({ division: '1' })
    }
  })

  it("leaves other divisions' quizzes alone", () => {
    expect(mergeEdits([named(1, '2', 'Calgry 1')], '1', 'Calgry 1', 'Calgary 1')).toEqual([])
  })
})
