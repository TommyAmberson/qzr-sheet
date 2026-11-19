import { createQuizStore } from '../../stores/quizStore'
import type { QuizRecord } from '../autoSave'
import { canonicalStoreFile } from '../quizFile'

/** A blank quiz's canonical file */
export function blankFile(): string {
  return canonicalStoreFile(createQuizStore(), new Map(), new Map())
}

/** A quiz record as a tab would write it, with what the test says differently */
export function aRecord(overrides: Partial<QuizRecord> = {}): QuizRecord {
  const file = blankFile()
  return {
    id: crypto.randomUUID(),
    current: { file, undo: [], redo: [] },
    start: file,
    link: null,
    fromNewerFile: false,
    unsaved: true,
    changedAt: Date.now(),
    offered: false,
    ...overrides,
  }
}
