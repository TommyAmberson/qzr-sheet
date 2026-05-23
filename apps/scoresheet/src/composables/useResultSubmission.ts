import { ref, computed, type ComputedRef, type Ref } from 'vue'
import { ApiError, type QuizFile } from '@qzr/shared'
import { postResult } from '../api'
import { useMeetSession } from './useMeetSession'

/** What the composable needs from useScoresheet. Decoupled so tests
 *  can fake it without spinning up the full store. */
export interface ScoresheetSubmitDeps {
  hasAnyErrors: Ref<boolean> | ComputedRef<boolean>
  allQuestionsComplete: Ref<boolean> | ComputedRef<boolean>
  quiz: { value: { division: string; quizNumber: string } }
  /** Build the full QuizFile object for the POST body. Caller supplies
   *  this so we don't need to drag the whole serializeStore signature
   *  (and its dependency tree) into the test surface. */
  buildQuizFile: () => QuizFile
}

export type SubmitOutcome = { ok: true } | { ok: false; duplicate?: boolean; error?: string }

/**
 * Orchestrates the submit flow: gates on completion + validity + meet
 * binding, calls postResult with quizId/roomId from the meet session,
 * surfaces a 409 as `{ ok: false, duplicate: true }` so the caller can
 * present the right alert, marks the meet session submitted on success
 * (which locks the UI via meetSession.isSubmitted).
 */
export function useResultSubmission(deps: ScoresheetSubmitDeps, session = useMeetSession()) {
  const submitting = ref(false)
  const submitError = ref<string | null>(null)

  const canSubmit = computed(
    () =>
      session.isActive.value &&
      !session.isSubmitted.value &&
      !deps.hasAnyErrors.value &&
      deps.allQuestionsComplete.value &&
      deps.quiz.value.division.trim() !== '' &&
      deps.quiz.value.quizNumber.trim() !== '',
  )

  async function submit(): Promise<SubmitOutcome> {
    if (!canSubmit.value) return { ok: false }
    const meetId = session.meetId.value
    if (meetId == null) return { ok: false }

    submitting.value = true
    submitError.value = null
    try {
      await postResult(meetId, {
        quizFile: deps.buildQuizFile(),
        quizId: session.quizId.value,
        roomId: session.roomId.value,
      })
      session.markSubmitted()
      return { ok: true }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        return { ok: false, duplicate: true }
      }
      const msg = e instanceof Error ? e.message : String(e)
      submitError.value = msg
      return { ok: false, error: msg }
    } finally {
      submitting.value = false
    }
  }

  return {
    submitting,
    submitError,
    canSubmit,
    submit,
    isSubmitted: session.isSubmitted,
  }
}
