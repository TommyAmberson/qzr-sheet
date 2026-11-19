import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { CellValue, QuestionCategory, type Timeout } from '@qzr/shared'
import { applyStep, recordEdit, type UndoStep, type UndoTarget } from '../undoSteps'
import { createQuizStore } from '../../stores/quizStore'
import { canonicalStoreFile } from '../../persistence/quizFile'

function target(): UndoTarget {
  return {
    store: createQuizStore(),
    noJumps: ref(new Map<string, boolean>()),
    timeouts: ref(new Map<number, Timeout[]>()),
  }
}

const state = ({ store, noJumps, timeouts }: UndoTarget) =>
  canonicalStoreFile(store, noJumps.value, timeouts.value)

// A step as it comes back from storage: no functions, no shared objects
const stored = (step: UndoStep): UndoStep => JSON.parse(JSON.stringify(step))

describe('undo steps as data', () => {
  const edits: [string, (t: UndoTarget) => void][] = [
    ['an answer', (t) => t.store.setAnswer(t.store.quizzers[0]!.id, '1', CellValue.Correct)],
    ['an answer cleared', (t) => t.store.setAnswer(t.store.quizzers[1]!.id, '2', CellValue.Empty)],
    ['a no-jump', (t) => (t.noJumps.value = new Map(t.noJumps.value).set('3', true))],
    [
      'a timeout added',
      (t) =>
        (t.timeouts.value = new Map(t.timeouts.value).set(t.store.teams[0]!.id, [
          { afterColumnKey: '4' },
        ])),
    ],
    [
      'a timeout upgraded',
      (t) =>
        (t.timeouts.value = new Map(t.timeouts.value).set(t.store.teams[1]!.id, [
          { afterColumnKey: '5' },
        ])),
    ],
    ['a timeout removed', (t) => (t.timeouts.value = new Map())],
    ['a team swap', (t) => t.store.swapTeams(t.store.teams[0]!.id, t.store.teams[2]!.id)],
    [
      'several names as one',
      (t) => {
        t.store.setTeamName(t.store.teams[0]!.id, 'First Church 1')
        t.store.setQuizzerName(t.store.quizzers[0]!.id, 'Alice')
      },
    ],
    ['a question type', (t) => t.store.setQuestionType('6', QuestionCategory.Q)],
    ['a quiz setting', (t) => (t.store.quiz.overtime = !t.store.quiz.overtime)],
  ]

  for (const [name, edit] of edits) {
    it(`undoes and redoes ${name} after being stored`, () => {
      const t = target()
      // Something on the sheet already, for the edit to change or leave alone
      t.store.setAnswer(t.store.quizzers[1]!.id, '2', CellValue.Error)
      t.timeouts.value = new Map([[t.store.teams[1]!.id, [{ afterColumnKey: null }]]])
      const before = state(t)
      const step = stored(recordEdit(t, () => edit(t)))
      const after = state(t)
      expect(after).not.toBe(before)
      applyStep(t, step, 'undo')
      expect(state(t)).toBe(before)
      applyStep(t, step, 'redo')
      expect(state(t)).toBe(after)
    })
  }

  it('records only what the edit changed', () => {
    const t = target()
    const step = recordEdit(t, () =>
      t.store.setAnswer(t.store.quizzers[0]!.id, '1', CellValue.Correct),
    )
    expect(step.changes).toHaveLength(1)
    // A name typed later, outside any step, survives undoing the step
    t.store.setTeamName(t.store.teams[0]!.id, 'Typed')
    applyStep(t, step, 'undo')
    expect(t.store.teams[0]!.name).toBe('Typed')
  })

  it('keeps the team list in seat order after undoing a swap', () => {
    const t = target()
    const ids = t.store.teams.map((team) => team.id)
    const step = stored(recordEdit(t, () => t.store.swapTeams(ids[0]!, ids[1]!)))
    applyStep(t, step, 'undo')
    expect(t.store.teams.map((team) => team.id)).toEqual(ids)
  })
})
