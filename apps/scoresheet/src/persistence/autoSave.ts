import {
  serializeStore,
  parseQuizFile,
  NewerFileVersionError,
  type DeserializeResult,
} from './quizFile'
import type { QuizStore } from '../stores/quizStore'
import type { Timeout } from '@qzr/shared'

const STORAGE_KEY = 'qzr-sheet:current'
const KEPT_NEWER_PREFIX = 'qzr-sheet:newer-autosave:'

// Keys holding a newer quiz that couldn't be set aside, so it stays where it is and nothing may
// write over it. For STORAGE_KEY that means auto-save pauses until the official discards it.
const keptInPlace = new Set<string>()

export function saveToStorage(
  store: QuizStore,
  noJumps: Map<string, boolean>,
  timeouts: Map<number, Timeout[]>,
): void {
  if (keptInPlace.has(STORAGE_KEY)) return
  try {
    localStorage.setItem(STORAGE_KEY, serializeStore(store, noJumps, timeouts))
  } catch {
    // localStorage full or unavailable — silently ignore
    return
  }
  // The quiz is now saved, so copies held back until it was can go
  for (const key of removeAfterSave) localStorage.removeItem(key)
  removeAfterSave.clear()
}

// Keys holding the only copy of the current quiz until auto-save next succeeds
const removeAfterSave = new Set<string>()

/** Remove `key` once the current quiz has actually been auto-saved (now, unless auto-save is paused) */
export function removeOnceSaved(key: string): void {
  if (keptInPlace.has(STORAGE_KEY)) removeAfterSave.add(key)
  else localStorage.removeItem(key)
}

/** Whether any newer quiz is kept where it was found; the tutorial won't start until none is */
export function hasNewerKeptInPlace(): boolean {
  return keptInPlace.size > 0
}

/** Set a newer build's quiz aside, under its own key so later auto-saves can't overwrite it */
export function keepNewerAutoSave(raw: string): boolean {
  try {
    localStorage.setItem(KEPT_NEWER_PREFIX + new Date().toISOString(), raw)
    return true
  } catch {
    return false
  }
}

export function loadFromStorage(): DeserializeResult | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseQuizFile(raw)
  } catch (e) {
    // A newer build's quiz can't be scored here but mustn't be lost: if it can't be set aside,
    // it stays where it is and auto-save pauses
    if (e instanceof NewerFileVersionError && raw) {
      if (keepNewerAutoSave(raw)) localStorage.removeItem(STORAGE_KEY)
      else keptInPlace.add(STORAGE_KEY)
      return null
    }
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

/** Keys of auto-saves from a newer version that were set aside on startup, most recent first */
export function listKeptNewerAutoSaves(): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(KEPT_NEWER_PREFIX)) keys.push(key)
    }
  } catch {
    return []
  }
  // ISO timestamps sort chronologically as strings
  keys.sort().reverse()
  return [...keptInPlace, ...keys]
}

/** Whether auto-save is paused to protect a newer auto-save that couldn't be set aside */
export function isAutoSavePausedForNewer(): boolean {
  return keptInPlace.has(STORAGE_KEY)
}

export function readKeptNewerAutoSave(key: string): string | null {
  return localStorage.getItem(key)
}

/** Record a newer quiz that couldn't be set aside: it stays at `key`, listed and never overwritten */
export function keepNewerInPlace(key: string): void {
  keptInPlace.add(key)
}

export function discardKeptNewerAutoSave(key: string): void {
  if (keptInPlace.delete(key) || key.startsWith(KEPT_NEWER_PREFIX)) localStorage.removeItem(key)
}

export function clearStorage(): void {
  if (keptInPlace.has(STORAGE_KEY)) return
  localStorage.removeItem(STORAGE_KEY)
}
