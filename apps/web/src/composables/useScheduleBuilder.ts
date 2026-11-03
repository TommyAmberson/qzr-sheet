import { computed, shallowRef } from 'vue'
import {
  checkSchedule,
  generateSchedule,
  newScheduleDocument,
  reflowSchedule,
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
) {
  const doc = shallowRef<ScheduleDocument>(initial)
  const history = useHistory()

  /** Apply a change to a copy of the document and make it the current one, undoably */
  function change(mutate: (draft: ScheduleDocument) => void) {
    const before = doc.value
    const after = structuredClone(before)
    mutate(after)
    doc.value = after
    history.push({
      undo: () => (doc.value = before),
      redo: () => (doc.value = after),
    })
  }

  /** A settings change: with Auto-apply on, the grid follows at once (FR-012a) */
  function changeSettings(mutate: (draft: ScheduleDocument) => void) {
    change((d) => {
      mutate(d)
      if (d.settings.autoApply) Object.assign(d, reflowSchedule(d))
    })
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
    conflicts,
    issues,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  }
}
