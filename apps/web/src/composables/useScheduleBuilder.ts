import { computed, shallowRef, type Ref } from 'vue'
import {
  checkSchedule,
  generateSchedule,
  newScheduleDocument,
  reflowSchedule,
  unappliedSettings,
  applyMoves,
  resultName,
  type Conflict,
  type ScheduleDocument,
} from '@qzr/shared'
import { useHistory } from '@qzr/ui'

/**
 * The schedule the builder is editing. Every change goes through `change`, which records the
 * document before and after it so undo and redo restore exactly that state (FR-006). Snapshots of a
 * whole document are cheap at schedule sizes (research R7).
 */
export function useScheduleBuilder(
  // A new schedule starts as a minimal generated frame, ready for teams (FR-010)
  initial: ScheduleDocument = generateSchedule(newScheduleDocument('New schedule')),
  /** Result names with submitted results, when linked: their quizzes are protected (H-20) */
  results?: Ref<Set<string>>,
) {
  const doc = shallowRef<ScheduleDocument>(initial)
  const history = useHistory()

  /** A change to quizzes with results, waiting for the director to confirm it (FR-035b) */
  const held = shallowRef<{ after: ScheduleDocument; quizzes: string[] } | null>(null)

  function commit(after: ScheduleDocument) {
    const before = doc.value
    doc.value = after
    history.push({
      undo: () => (doc.value = before),
      redo: () => (doc.value = after),
    })
  }

  /** Apply a change to a copy of the document and make it the current one, undoably */
  function change(mutate: (draft: ScheduleDocument) => void) {
    const after = structuredClone(doc.value)
    mutate(after)
    const touched = touchedWithResults(doc.value, after)
    if (touched.length > 0) {
      held.value = { after, quizzes: touched }
      return
    }
    commit(after)
  }

  /** The protected quizzes a change moves, reseats, renames or deletes */
  function touchedWithResults(before: ScheduleDocument, after: ScheduleDocument): string[] {
    if (!results || results.value.size === 0) return []
    const shape = (q: ScheduleDocument['quizzes'][number] | undefined) =>
      q
        ? JSON.stringify([q.label, q.division, q.phase, q.lane, q.line, q.cell, q.seats])
        : 'deleted'
    const afterById = new Map(after.quizzes.map((q) => [q.id, q]))
    return before.quizzes
      .filter((q) => results.value.has(resultName(q)))
      .filter((q) => shape(q) !== shape(afterById.get(q.id)))
      .map((q) => q.id)
  }

  /** Make the held change, marking its quizzes changed after results */
  function confirmHeld() {
    const h = held.value
    if (!h) return
    held.value = null
    for (const q of h.after.quizzes) if (h.quizzes.includes(q.id)) q.changedAfterResults = true
    commit(h.after)
  }

  function dropHeld() {
    held.value = null
  }

  /** A settings change: with Auto-apply on, the grid follows at once (FR-012a) */
  function changeSettings(mutate: (draft: ScheduleDocument) => void) {
    change((d) => {
      mutate(d)
      if (d.settings.autoApply) Object.assign(d, reflowSchedule(d))
    })
  }

  /** Turning Auto-apply on applies whatever is waiting; it isn't itself a setting to apply */
  function setAutoApply(on: boolean) {
    change((d) => {
      d.settings.autoApply = on
      d.applied.autoApply = on
      if (on) Object.assign(d, reflowSchedule(d))
    })
  }

  /** Settings the grid wasn't built with, and how many quizzes applying them would move */
  const unapplied = computed(() => unappliedSettings(doc.value))
  const pendingMoves = () => applyMoves(doc.value)
  function apply() {
    change((d) => Object.assign(d, reflowSchedule(d)))
  }

  const conflicts = computed(() => checkSchedule(doc.value))
  /** Conflicts by quiz, for marking cells */
  const issues = computed(() => {
    const byQuiz = new Map<string, Conflict[]>()
    for (const c of conflicts.value)
      for (const id of c.quizzes) byQuiz.set(id, [...(byQuiz.get(id) ?? []), c])
    return byQuiz
  })

  return {
    doc,
    change,
    changeSettings,
    setAutoApply,
    unapplied,
    pendingMoves,
    apply,
    conflicts,
    issues,
    held,
    confirmHeld,
    dropHeld,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  }
}
