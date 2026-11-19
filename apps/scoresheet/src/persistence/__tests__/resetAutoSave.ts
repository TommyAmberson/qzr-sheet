import { discardKeptNewerAutoSave, listKeptNewerAutoSaves } from '../autoSave'

/**
 * Empty localStorage and auto-save's module state between tests. The state outlives
 * localStorage.clear(), so discard every kept quiz first.
 */
export function resetAutoSave(): void {
  for (const key of listKeptNewerAutoSaves()) discardKeptNewerAutoSave(key)
  localStorage.clear()
}
