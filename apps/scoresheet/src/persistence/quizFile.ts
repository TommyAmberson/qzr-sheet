import { serialize, type QuizFile, type Timeout } from '@qzr/shared'
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
