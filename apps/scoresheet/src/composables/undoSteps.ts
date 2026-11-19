import type { Ref } from 'vue'
import {
  CellValue,
  type QuestionCategory,
  type Quiz,
  type QuizzerId,
  type Timeout,
} from '@qzr/shared'
import type { QuizStore } from '../stores/quizStore'

/** The parts of a quiz an edit can change, one value each */
export type UndoPart =
  | { kind: 'answer'; quizzerId: QuizzerId; column: string }
  | { kind: 'noJump'; column: string }
  | { kind: 'timeouts'; teamId: number }
  | { kind: 'questionType'; column: string }
  | { kind: 'team'; teamId: number; field: (typeof TEAM_FIELDS)[number] }
  | { kind: 'quizzer'; quizzerId: QuizzerId; field: (typeof QUIZZER_FIELDS)[number] }
  | { kind: 'quiz'; field: (typeof QUIZ_FIELDS)[number] }

/**
 * One undoable edit as data, which can be stored and read back: for each part of the quiz the edit
 * changed, its value before and after. A part absent before or after is null.
 */
export interface UndoStep {
  changes: { part: UndoPart; before: unknown; after: unknown }[]
}

/** What an undo step reads and writes */
export interface UndoTarget {
  store: QuizStore
  noJumps: Ref<Map<string, boolean>>
  timeouts: Ref<Map<number, Timeout[]>>
}

const TEAM_FIELDS = ['name', 'onTime', 'seatOrder'] as const
const QUIZZER_FIELDS = ['name', 'seatOrder', 'teamId'] as const
const QUIZ_FIELDS = [
  'division',
  'quizNumber',
  'overtime',
  'consolation',
  'placementFormula',
  'bonusRule',
  'format',
] as const satisfies readonly (keyof Quiz)[]

type Snapshot = Map<string, { part: UndoPart; value: string }>

function snapshot({ store, noJumps, timeouts }: UndoTarget): Snapshot {
  const parts: Snapshot = new Map()
  const add = (part: UndoPart, value: unknown) => {
    if (value === undefined || value === null) return
    parts.set(JSON.stringify(part), { part, value: JSON.stringify(value) })
  }
  for (const a of store.answers) {
    add({ kind: 'answer', quizzerId: a.quizzerId, column: a.columnKey }, a.value)
  }
  for (const [column, on] of noJumps.value) if (on) add({ kind: 'noJump', column }, true)
  for (const [teamId, list] of timeouts.value) {
    if (list.length > 0) add({ kind: 'timeouts', teamId }, list)
  }
  for (const [column, category] of store.quiz.questionTypes) {
    add({ kind: 'questionType', column }, category)
  }
  for (const team of store.teams) {
    for (const field of TEAM_FIELDS) add({ kind: 'team', teamId: team.id, field }, team[field])
  }
  for (const quizzer of store.quizzers) {
    for (const field of QUIZZER_FIELDS) {
      add({ kind: 'quizzer', quizzerId: quizzer.id, field }, quizzer[field])
    }
  }
  for (const field of QUIZ_FIELDS) add({ kind: 'quiz', field }, store.quiz[field])
  return parts
}

/** Make `change` and record it as a step: each part it changed, before and after */
export function recordEdit(target: UndoTarget, change: () => void): UndoStep {
  const before = snapshot(target)
  change()
  const after = snapshot(target)
  const changes: UndoStep['changes'] = []
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key)
    const now = after.get(key)
    if (was?.value === now?.value) continue
    changes.push({
      part: (was ?? now)!.part,
      before: was ? JSON.parse(was.value) : null,
      after: now ? JSON.parse(now.value) : null,
    })
  }
  return { changes }
}

/** Put the quiz back as it was before `step` (undo), or as it was after it (redo) */
export function applyStep(
  { store, noJumps, timeouts }: UndoTarget,
  step: UndoStep,
  direction: 'undo' | 'redo',
): void {
  let reseated = false
  for (const change of step.changes) {
    const value = direction === 'undo' ? change.before : change.after
    const { part } = change
    switch (part.kind) {
      case 'answer':
        store.setAnswer(part.quizzerId, part.column, (value as CellValue | null) ?? CellValue.Empty)
        break
      case 'noJump':
        noJumps.value = new Map(noJumps.value).set(part.column, value === true)
        break
      case 'timeouts': {
        const next = new Map(timeouts.value)
        if (value) next.set(part.teamId, value as Timeout[])
        else next.delete(part.teamId)
        timeouts.value = next
        break
      }
      case 'questionType':
        store.setQuestionType(part.column, value as QuestionCategory | null)
        break
      case 'team': {
        const team = store.teams.find((t) => t.id === part.teamId)
        if (team) Object.assign(team, { [part.field]: value })
        reseated ||= part.field === 'seatOrder'
        break
      }
      case 'quizzer': {
        const quizzer = store.quizzers.find((q) => q.id === part.quizzerId)
        if (quizzer) Object.assign(quizzer, { [part.field]: value })
        break
      }
      case 'quiz':
        Object.assign(store.quiz, { [part.field]: value })
        break
    }
  }
  // The team list stays in seat order, as the store's own swap keeps it
  if (reseated) store.teams.sort((a, b) => a.seatOrder - b.seatOrder)
}
