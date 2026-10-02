import { serialize } from '@qzr/shared'
import type { Timeout } from '@qzr/shared'
import type { QuizStore } from '../stores/quizStore'

/** Serialize store state to a JSON string */
export function serializeStore(
  store: QuizStore,
  noJumps: Map<string, boolean>,
  timeouts: Map<number, Timeout[]>,
): string {
  return JSON.stringify(
    serialize({
      quiz: store.quiz,
      teams: store.teams,
      quizzers: store.quizzers,
      answers: store.answers,
      noJumps,
      timeouts,
    }),
    null,
    2,
  )
}
