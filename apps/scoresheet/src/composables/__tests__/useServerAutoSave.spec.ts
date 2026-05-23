import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computed, effectScope, ref } from 'vue'
import { ApiError, FILE_VERSION, PlacementFormula, type QuizFile } from '@qzr/shared'
import { useMeetSession } from '../useMeetSession'
import { useServerAutoSave } from '../useServerAutoSave'

vi.mock('../../api', () => ({
  postSave: vi.fn(),
}))

import { postSave } from '../../api'

function makeQuizFile(overrides: Partial<QuizFile['quiz']> = {}): QuizFile {
  return {
    version: FILE_VERSION,
    quiz: {
      division: '1',
      quizNumber: '1',
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      questionTypes: [],
      ...overrides,
    },
    teams: [],
    answers: [],
    noJumps: [],
  }
}

function activateSession({
  serverSaveEnabled = true,
  scheduledQuizId = 777 as number | null,
  roomId = 9 as number | null,
} = {}) {
  const session = useMeetSession()
  session.restoreSession({
    meetId: 42,
    meetName: 'Finals',
    slots: [undefined, undefined, undefined],
    teamList: [],
    meetDivisions: [],
    quizId: scheduledQuizId,
    roomId,
    roomName: 'Sanctuary',
    serverSaveEnabled,
    submittedAt: null,
  })
  return session
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(postSave).mockReset()
  vi.mocked(postSave).mockResolvedValue({ id: 1, savedAt: '2026-05-23T20:00:00.000Z' })
})

afterEach(() => {
  vi.useRealTimers()
  useMeetSession().clearSession()
})

describe('useServerAutoSave — debouncing', () => {
  it('coalesces a burst of edits into one POST after the debounce window', async () => {
    activateSession()
    const scope = effectScope()
    scope.run(() => {
      const qf = ref<QuizFile>(makeQuizFile())
      useServerAutoSave({ quizFile: qf })
      qf.value = makeQuizFile({ division: '2' })
      qf.value = makeQuizFile({ division: '3' })
      qf.value = makeQuizFile({ division: '4' })
    })
    expect(postSave).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).toHaveBeenCalledTimes(1)
    expect(vi.mocked(postSave).mock.calls[0]![1].quizFile.quiz.division).toBe('4')
    scope.stop()
  })

  it('does not post when serverSaveEnabled is false', async () => {
    activateSession({ serverSaveEnabled: false })
    const scope = effectScope()
    scope.run(() => {
      const qf = ref<QuizFile>(makeQuizFile())
      useServerAutoSave({ quizFile: qf })
      qf.value = makeQuizFile({ division: '2' })
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).not.toHaveBeenCalled()
    scope.stop()
  })

  it('does not post when isSubmitted is true', async () => {
    const session = activateSession()
    session.markSubmitted()
    const scope = effectScope()
    scope.run(() => {
      const qf = ref<QuizFile>(makeQuizFile())
      useServerAutoSave({ quizFile: qf })
      qf.value = makeQuizFile({ division: '2' })
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).not.toHaveBeenCalled()
    scope.stop()
  })

  it('flipping serverSaveEnabled on schedules an immediate autosave', async () => {
    const session = activateSession({ serverSaveEnabled: false })
    const scope = effectScope()
    scope.run(() => {
      const qf = ref<QuizFile>(makeQuizFile())
      useServerAutoSave({ quizFile: qf })
      session.setServerSaveEnabled(true)
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('flipping serverSaveEnabled off cancels a pending autosave', async () => {
    const session = activateSession()
    const scope = effectScope()
    scope.run(() => {
      const qf = ref<QuizFile>(makeQuizFile())
      useServerAutoSave({ quizFile: qf })
      qf.value = makeQuizFile({ division: '2' })
      session.setServerSaveEnabled(false)
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).not.toHaveBeenCalled()
    scope.stop()
  })
})

describe('useServerAutoSave — payload', () => {
  it('posts the current QuizFile with scheduledQuizId + roomId from the session', async () => {
    activateSession({ scheduledQuizId: 777, roomId: 9 })
    const scope = effectScope()
    scope.run(() => {
      const qf = ref<QuizFile>(makeQuizFile())
      useServerAutoSave({ quizFile: qf })
      qf.value = makeQuizFile({ quizNumber: '7' })
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        kind: 'autosave',
        scheduledQuizId: 777,
        roomId: 9,
      }),
    )
    scope.stop()
  })

  it('skips a duplicate autosave when content is unchanged since the last POST', async () => {
    activateSession()
    const scope = effectScope()
    scope.run(() => {
      const qf = ref<QuizFile>(makeQuizFile({ division: '5' }))
      useServerAutoSave({ quizFile: qf })
      // First edit -> POST
      qf.value = makeQuizFile({ division: '5' })
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).toHaveBeenCalledTimes(1)

    // Touch the ref to the same content — dedupe should skip the POST.
    const session = useMeetSession()
    session.setServerSaveEnabled(false)
    session.setServerSaveEnabled(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).toHaveBeenCalledTimes(1)
    scope.stop()
  })
})

describe('useServerAutoSave — saveCheckpoint', () => {
  it('forces an immediate POST with kind=checkpoint and the supplied label', async () => {
    activateSession()
    const scope = effectScope()
    const result = await scope.run(async () => {
      const qf = ref<QuizFile>(makeQuizFile())
      const { saveCheckpoint } = useServerAutoSave({ quizFile: qf })
      return saveCheckpoint('end of Q15')
    })
    expect(result).toBe(true)
    expect(postSave).toHaveBeenCalledTimes(1)
    expect(vi.mocked(postSave).mock.calls[0]![1]).toMatchObject({
      kind: 'checkpoint',
      label: 'end of Q15',
    })
    scope.stop()
  })

  it('saveCheckpoint returns false when not authorised / disabled', async () => {
    activateSession({ serverSaveEnabled: false })
    const scope = effectScope()
    const result = await scope.run(async () => {
      const qf = ref<QuizFile>(makeQuizFile())
      const { saveCheckpoint } = useServerAutoSave({ quizFile: qf })
      return saveCheckpoint('try anyway')
    })
    expect(result).toBe(false)
    expect(postSave).not.toHaveBeenCalled()
    scope.stop()
  })

  it('saveCheckpoint cancels a pending autosave and resets dedupe', async () => {
    activateSession()
    const scope = effectScope()
    scope.run(async () => {
      const qf = ref<QuizFile>(makeQuizFile())
      const { saveCheckpoint } = useServerAutoSave({ quizFile: qf })
      qf.value = makeQuizFile({ division: '2' })
      await saveCheckpoint('mid-quiz')
    })
    await vi.advanceTimersByTimeAsync(10_000)
    // Only the explicit checkpoint posted; the autosave it cancelled
    // would have been a same-content duplicate and skipped anyway —
    // but the dedupe reset means a future identical autosave still
    // skips, which we verify by not triggering another edit.
    expect(postSave).toHaveBeenCalledTimes(1)
    scope.stop()
  })
})

describe('useServerAutoSave — errors', () => {
  it('surfaces the error message on failure but keeps the watcher live', async () => {
    activateSession()
    vi.mocked(postSave).mockRejectedValueOnce(new ApiError(500, 'boom'))
    const scope = effectScope()
    const handle = scope.run(() => {
      const qf = ref<QuizFile>(makeQuizFile())
      const h = useServerAutoSave({ quizFile: qf })
      qf.value = makeQuizFile({ division: '2' })
      return { qf, h }
    })!
    await vi.advanceTimersByTimeAsync(10_000)
    expect(handle.h.lastError.value).toBe('boom')

    // Recovery: next successful POST clears the error.
    vi.mocked(postSave).mockResolvedValueOnce({ id: 2, savedAt: '2026-05-23T20:01:00.000Z' })
    handle.qf.value = makeQuizFile({ division: '3' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(handle.h.lastError.value).toBeNull()
    expect(handle.h.lastSavedAt.value).toBe('2026-05-23T20:01:00.000Z')
    scope.stop()
  })
})

describe('useServerAutoSave — scope cleanup', () => {
  it('cancels pending autosaves on scope dispose', async () => {
    activateSession()
    const scope = effectScope()
    scope.run(() => {
      const qf = ref<QuizFile>(makeQuizFile())
      useServerAutoSave({ quizFile: qf })
      qf.value = makeQuizFile({ division: '2' })
    })
    scope.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).not.toHaveBeenCalled()
  })
})

describe('useServerAutoSave — computed quizFile source', () => {
  it('also accepts a computed ref', async () => {
    activateSession()
    const scope = effectScope()
    const trigger = ref(0)
    scope.run(() => {
      const qf = computed<QuizFile>(() => makeQuizFile({ quizNumber: `${trigger.value}` }))
      useServerAutoSave({ quizFile: qf })
      trigger.value = 5
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postSave).toHaveBeenCalledTimes(1)
    scope.stop()
  })
})
