import { computed, shallowRef } from 'vue'
import { checkSchedule, newScheduleDocument, type ScheduleDocument } from '@qzr/shared'
import { useHistory } from '@qzr/ui'

/**
 * The schedule the builder is editing. Every change goes through `change`, which records the
 * document before and after it so undo and redo restore exactly that state (FR-006). Snapshots of a
 * whole document are cheap at schedule sizes (research R7).
 */
export function useScheduleBuilder(
  initial: ScheduleDocument = newScheduleDocument('New schedule'),
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

  const conflicts = computed(() => checkSchedule(doc.value))

  return {
    doc,
    change,
    conflicts,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  }
}
