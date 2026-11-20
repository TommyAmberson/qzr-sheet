import { describe, it, expect } from 'vitest'
import { CellValue, PlacementFormula, type QuizFile } from '@qzr/shared'
import type { StoredQuiz } from '../api'
import { editQuizFile, groupResults, mergeEdits } from '../results'

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
    stage: null,
    stageFrom: null,
    link: null,
    problems: [],
    accepted: false,
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
      revision: 2,
      action: 'restored',
      savedBy: 'Pat',
      stage: null,
      accepted: false,
    })
    expect(row!.teams.map((t) => [t.name, t.score])).toEqual([
      ['Calgary 1', 40],
      ['Regina 1', 0],
    ])
    // One question answered of fifteen: not placeable yet
    expect(row!.placed).toBe(false)
  })

  it('places a quiz accepted as scored by its scores, as the standings do', () => {
    // One question answered of fifteen: unplaceable as it stands, placed once accepted
    const [row] = groupResults([stored(1, '1', '3', { accepted: true })])[0]!.quizzes
    expect(row!.placed).toBe(true)
    expect(row!.teams.map((t) => [t.name, t.place, t.placementPoints])).toEqual([
      ['Calgary 1', 1, 10],
      ['Regina 1', 2, 5],
    ])
  })

  it('keeps consolation quizzes apart', () => {
    const consolation = stored(2, '1', '3')
    consolation.quizFile.quiz.consolation = true
    const [group] = groupResults([consolation, stored(1, '1', '3')])
    expect(group!.quizzes.map((q) => q.name)).toEqual(['D1 Q3', 'D1c Q3'])
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

  it('finds the division however the quiz files case and space it', () => {
    // The stats name a division as the meet lists it; the files may write it another way
    const edits = mergeEdits([named(1, ' open', 'Calgry 1')], 'Open', 'Calgry 1', 'Calgary 1')
    expect(edits.map((edit) => edit.id)).toEqual([1])
  })

  it("leaves other divisions' quizzes alone", () => {
    expect(mergeEdits([named(1, '2', 'Calgry 1')], '1', 'Calgry 1', 'Calgary 1')).toEqual([])
  })

  it('renames a quizzer on the team given, and not a quizzer of that name on another team', () => {
    const quiz = stored(1, '1', '1')
    const [first, second] = quiz.quizFile.teams
    const spelt = (id: number, name: string) => ({ id, name, seatOrder: 0 })
    quiz.quizFile.teams = [
      { ...first!, quizzers: [spelt(9, 'Jordon Lee')] },
      { ...second!, quizzers: [spelt(10, 'Jordon Lee')] },
    ]
    const edits = mergeEdits([quiz], '1', 'jordon lee', 'Jordan Lee', first!.name)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.quizFile.teams.map((t) => t.quizzers.map((q) => q.name))).toEqual([
      ['Jordan Lee'],
      ['Jordon Lee'],
    ])
  })
})
