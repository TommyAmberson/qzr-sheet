import { createQuizStore } from '../../stores/quizStore'
import type { QuizRecord } from '../autoSave'
import { canonicalStoreFile } from '../quizFile'

/** A blank quiz's canonical file */
function blankFile(): string {
  return canonicalStoreFile(createQuizStore(), new Map(), new Map())
}

/**
 * A quiz record as a tab would write it, with what the test says differently: by default one
 * edited by hand since it began, so kept as a recent quiz once its tab goes
 */
export function aRecord(overrides: Partial<QuizRecord> = {}): QuizRecord {
  const file = blankFile()
  return {
    id: crypto.randomUUID(),
    current: { file, undo: [], redo: [] },
    start: '',
    link: null,
    fromNewerFile: false,
    unsaved: true,
    changedAt: Date.now(),
    offered: false,
    ...overrides,
  }
}
