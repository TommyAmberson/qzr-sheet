import { computed, shallowRef } from 'vue'

export interface HistoryCommand {
  undo: () => void
  redo: () => void
}

const DEFAULT_MAX = 100

const last = <T>(steps: readonly T[]): T | undefined => steps[steps.length - 1]

/**
 * Undo and redo over steps of the caller's own type. The stacks can be read and set, oldest step
 * first, so a caller can keep them beyond the page.
 */
export function useHistory<Step extends HistoryCommand = HistoryCommand>(maxHistory = DEFAULT_MAX) {
  // Shallow, and replaced rather than mutated: steps are the caller's, and need not be reactive
  const undoStack = shallowRef<readonly Step[]>([])
  const redoStack = shallowRef<readonly Step[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const undoSteps = computed(() => undoStack.value)
  const redoSteps = computed(() => redoStack.value)

  function push(command: Step) {
    undoStack.value = [...undoStack.value, command].slice(-maxHistory)
    redoStack.value = []
  }

  function undo() {
    const command = last(undoStack.value)
    if (!command) return
    undoStack.value = undoStack.value.slice(0, -1)
    command.undo()
    redoStack.value = [...redoStack.value, command]
  }

  function redo() {
    const command = last(redoStack.value)
    if (!command) return
    redoStack.value = redoStack.value.slice(0, -1)
    command.redo()
    undoStack.value = [...undoStack.value, command]
  }

  function clear() {
    undoStack.value = []
    redoStack.value = []
  }

  /** Replace both stacks, as a caller kept them: `redo`'s last step is the next one redone */
  function setStacks(undo: readonly Step[], redo: readonly Step[]) {
    undoStack.value = undo.slice(-maxHistory)
    redoStack.value = [...redo]
  }

  return {
    canUndo,
    canRedo,
    undoSteps,
    redoSteps,
    push,
    undo,
    redo,
    clear,
    setStacks,
  }
}
