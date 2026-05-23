import { ref, watch, onScopeDispose, type Ref, type ComputedRef } from 'vue'
import { ApiError, type QuizFile } from '@qzr/shared'
import { postSave } from '../api'
import { useMeetSession } from './useMeetSession'

/** Default debounce — long enough that a burst of cell edits coalesces
 *  into one POST, short enough that a tablet crash loses ≤ this much. */
const DEFAULT_DEBOUNCE_MS = 10_000

export interface ServerAutoSaveDeps {
  /** Reactive QuizFile (or factory). Each new identity triggers a
   *  debounced POST. */
  quizFile: Ref<QuizFile> | ComputedRef<QuizFile>
}

/**
 * Streams the scoresheet's current QuizFile to the server while the
 * meet session has `serverSaveEnabled === true`. Debounced — a flurry
 * of edits collapses into one POST. Silent on errors (the localStorage
 * autosave is still the durable copy).
 *
 * Cancelled inflight when the session opts out, when the meet is
 * unlinked, or when the consumer scope unmounts. Does NOT fire after
 * `markSubmitted` — that's the lock signal; further edits still flow
 * to localStorage but not to the server until a fresh binding.
 *
 * Skipping the server doesn't disable local autosave — see
 * persistence/autoSave.ts for the local path that always runs.
 */
export function useServerAutoSave(
  deps: ServerAutoSaveDeps,
  session = useMeetSession(),
  debounceMs = DEFAULT_DEBOUNCE_MS,
) {
  const lastSavedAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  const inflight = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let lastPostedSerialised: string | null = null

  function shouldSave(): boolean {
    return (
      session.isActive.value &&
      session.serverSaveEnabled.value &&
      !session.isSubmitted.value &&
      session.meetId.value != null
    )
  }

  async function postNow(kind: 'autosave' | 'checkpoint', label?: string): Promise<boolean> {
    const meetId = session.meetId.value
    if (meetId == null) return false
    if (kind === 'autosave' && !shouldSave()) return false

    const payload = deps.quizFile.value
    const serialised = JSON.stringify(payload)
    // Skip duplicate autosaves — same content as the last POST.
    if (kind === 'autosave' && serialised === lastPostedSerialised) return false

    inflight.value = true
    lastError.value = null
    try {
      const res = await postSave(meetId, {
        quizFile: payload,
        kind,
        scheduledQuizId: session.quizId.value,
        roomId: session.roomId.value,
        label: label ?? null,
      })
      lastSavedAt.value = res.savedAt
      lastPostedSerialised = serialised
      return true
    } catch (e) {
      lastError.value =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
      return false
    } finally {
      inflight.value = false
    }
  }

  function cancelPendingAutosave() {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function scheduleAutosave() {
    cancelPendingAutosave()
    if (!shouldSave()) return
    timer = setTimeout(() => {
      timer = null
      void postNow('autosave')
    }, debounceMs)
  }

  /** Force a checkpoint save (manual "Save to server" button). Bypasses
   *  the debounce + the same-content skip; respects opt-in + submitted
   *  guards. Returns true on success. */
  function saveCheckpoint(label?: string): Promise<boolean> {
    if (!shouldSave()) return Promise.resolve(false)
    cancelPendingAutosave()
    // Reset the dedupe sentinel so the next autosave still posts even
    // if the user makes zero edits after the checkpoint.
    lastPostedSerialised = null
    return postNow('checkpoint', label)
  }

  // Watch the QuizFile identity (deep) — re-arms the debounce on every
  // edit. The serialise + compare in postNow handles same-content
  // no-ops (resetStore producing an identical JSON, etc.).
  watch(
    () => deps.quizFile.value,
    () => scheduleAutosave(),
    { deep: true },
  )
  // Also react to opt-in flips so turning the toggle on triggers an
  // immediate autosave of the current state.
  watch(
    () => session.serverSaveEnabled.value,
    (enabled) => {
      if (enabled) scheduleAutosave()
      else cancelPendingAutosave()
    },
  )
  // If the meet binding changes (new quiz loaded, unlinked, etc.),
  // reset the dedupe sentinel — the next save is conceptually new.
  watch(
    () => `${session.meetId.value ?? 'none'}:${session.quizId.value ?? 'none'}`,
    () => {
      lastPostedSerialised = null
    },
  )

  onScopeDispose(() => {
    cancelPendingAutosave()
  })

  return {
    /** ISO timestamp returned by the server for the most recent successful save. */
    lastSavedAt,
    /** Last error message, or null after a successful save. */
    lastError,
    /** True while a POST is in flight. */
    inflight,
    /** Manual checkpoint — returns true on success. */
    saveCheckpoint,
  }
}
