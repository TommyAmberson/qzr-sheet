import { createQuizStore } from '../../stores/quizStore'
import { discardKeptNewerAutoSave, listKeptNewerAutoSaves, saveToStorage } from '../autoSave'

/**
 * Empty localStorage and auto-save's module state between tests. The state outlives
 * localStorage.clear(), so discard every kept quiz (resuming auto-save), then save once to flush
 * removals waiting on a save.
 */
export function resetAutoSave(): void {
  for (const key of listKeptNewerAutoSaves()) discardKeptNewerAutoSave(key)
  saveToStorage(createQuizStore(), new Map(), new Map())
  localStorage.clear()
}
