import { serialize, type QuizFile, type SerializeInput, type Timeout } from '@qzr/shared'
import type { QuizStore } from '../stores/quizStore'

/** The store's quiz as a quiz file */
export function storeToQuizFile(
  store: QuizStore,
  noJumps: Map<string, boolean>,
  timeouts: Map<number, Timeout[]>,
): QuizFile {
  return serialize({
    quiz: store.quiz,
    teams: store.teams,
    quizzers: store.quizzers,
    answers: store.answers,
    noJumps,
    timeouts,
  })
}

/** Serialize store state to a JSON string */
export function serializeStore(
  store: QuizStore,
  noJumps: Map<string, boolean>,
  timeouts: Map<number, Timeout[]>,
): string {
  return JSON.stringify(storeToQuizFile(store, noJumps, timeouts), null, 2)
}

const byKey =
  <T>(key: (item: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0

/** The store's quiz as a canonical file (canonicalQuizFile) */
export function canonicalStoreFile(
  store: QuizStore,
  noJumps: Map<string, boolean>,
  timeouts: Map<number, Timeout[]>,
): string {
  return canonicalQuizFile({ ...store, answers: store.answers, noJumps, timeouts })
}

/**
 * The quiz as a file, in one form whatever order its edits came in: two quizzes are in the same
 * state exactly when these strings are equal. What a file holds counts, and nothing else, so the
 * meet link is no part of it.
 */
export function canonicalQuizFile(input: SerializeInput): string {
  const file = serialize(input)
  file.quiz.questionTypes.sort(byKey(([column]) => column))
  file.answers.sort(byKey((a) => `${a.quizzerId}:${a.columnKey}`))
  file.noJumps.sort()
  for (const team of file.teams) team.timeouts?.sort(byKey((t) => t.afterColumnKey ?? ''))
  return JSON.stringify(file)
}
