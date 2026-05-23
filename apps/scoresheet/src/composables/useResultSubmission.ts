import { ref, computed, type ComputedRef, type Ref } from 'vue'
import { ApiError, type QuizFile } from '@qzr/shared'
import { postResult } from '../api'
import { useMeetSession } from './useMeetSession'

export interface ScoresheetSubmitDeps {
  hasAnyErrors: Ref<boolean> | ComputedRef<boolean>
  allQuestionsComplete: Ref<boolean> | ComputedRef<boolean>
  quiz: { value: { division: string; quizNumber: string } }
  buildQuizFile: () => QuizFile
}

export type SubmitOutcome = { ok: true } | { ok: false; duplicate?: boolean; error?: string }

/**
 * Submit = freeze the current QuizFile as the official record. Distinct
 * from server autosave (history of in-progress saves) — Submit is the
 * room-level "we're done with this quiz" status flip. After success the
 * meet session is markedSubmitted; the local UI locks; the server's
 * /saves history keeps accepting rows (audit) but quiz_results stays
 * frozen.
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
