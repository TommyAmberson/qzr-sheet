import { serializeStore, parseQuizFile, type DeserializeResult } from './quizFile'
import type { QuizStore } from '../stores/quizStore'
import type { Timeout } from '../types/scoresheet'

const STORAGE_KEY = 'qzr-sheet:current'

export function saveToStorage(
  store: QuizStore,
  noJumps: Map<string, boolean>,
  timeouts: Map<number, Timeout[]>,
): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeStore(store, noJumps, timeouts))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function loadFromStorage(): DeserializeResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseQuizFile(raw)
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function clearStorage(): void {
  localStorage.removeItem(STORAGE_KEY)
}
