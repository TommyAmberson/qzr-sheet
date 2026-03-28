import { ref, computed } from 'vue'

export interface HistoryCommand {
  undo: () => void
  redo: () => void
}

const DEFAULT_MAX = 100

export function useHistory(maxHistory = DEFAULT_MAX) {
  const undoStack = ref<HistoryCommand[]>([])
  const redoStack = ref<HistoryCommand[]>([])

  // Tracks the command at the top of the undo stack when last saved.
  // null means "saved at empty state" (fresh/cleared).
  const savedCommand = ref<HistoryCommand | null>(null)

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  const isDirty = computed(
    () => (undoStack.value[undoStack.value.length - 1] ?? null) !== savedCommand.value,
  )

  function push(command: HistoryCommand) {
    undoStack.value.push(command)
    if (undoStack.value.length > maxHistory) {
      undoStack.value.shift()
    }
    redoStack.value = []
  }

  function undo() {
    const command = undoStack.value.pop()
    if (!command) return
    command.undo()
    redoStack.value.push(command)
  }

  function redo() {
    const command = redoStack.value.pop()
    if (!command) return
    command.redo()
    undoStack.value.push(command)
  }

  function clear() {
    undoStack.value = []
    redoStack.value = []
    savedCommand.value = null
  }

  function markSaved() {
    savedCommand.value = undoStack.value[undoStack.value.length - 1] ?? null
  }

  return { canUndo, canRedo, isDirty, push, undo, redo, clear, markSaved }
}
