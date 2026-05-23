import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { ApiError, FILE_VERSION, PlacementFormula, type QuizFile } from '@qzr/shared'
import { useMeetSession } from '../useMeetSession'
import { useResultSubmission, type ScoresheetSubmitDeps } from '../useResultSubmission'

vi.mock('../../api', () => ({
  postResult: vi.fn(),
}))

import { postResult } from '../../api'

function makeQuizFile(): QuizFile {
  return {
    version: FILE_VERSION,
    quiz: {
      division: '1',
      quizNumber: '1',
      overtime: false,
      placementFormula: PlacementFormula.Rules,
      questionTypes: [],
    },
    teams: [],
    answers: [],
    noJumps: [],
  }
}

function makeDeps(overrides: Partial<ScoresheetSubmitDeps> = {}): ScoresheetSubmitDeps {
  return {
    hasAnyErrors: ref(false),
    allQuestionsComplete: ref(true),
    quiz: { value: { division: '1', quizNumber: '1' } },
    buildQuizFile: () => makeQuizFile(),
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(postResult).mockReset()
})

describe('useResultSubmission — canSubmit', () => {
  it('is false when no meet session is active', () => {
    const { canSubmit } = useResultSubmission(makeDeps())
    expect(canSubmit.value).toBe(false)
  })

  it('is true when meet active + valid + complete + meta filled', () => {
    const session = useMeetSession()
    session.restoreSession({
      meetId: 1,
      meetName: 'Meet',
      slots: [undefined, undefined, undefined],
      teamList: [],
      meetDivisions: [],
      quizId: null,
      roomId: null,
      roomName: null,
      submittedAt: null,
    })
    const { canSubmit } = useResultSubmission(makeDeps())
    expect(canSubmit.value).toBe(true)
    session.clearSession()
  })

  it('is false when there are validation errors', () => {
    const session = useMeetSession()
    session.restoreSession({
      meetId: 1,
      meetName: 'Meet',
      slots: [undefined, undefined, undefined],
      teamList: [],
      meetDivisions: [],
      quizId: null,
      roomId: null,
      roomName: null,
      submittedAt: null,
    })
    const { canSubmit } = useResultSubmission(makeDeps({ hasAnyErrors: ref(true) }))
    expect(canSubmit.value).toBe(false)
    session.clearSession()
  })

  it('is false when questions are incomplete', () => {
    const session = useMeetSession()
    session.restoreSession({
      meetId: 1,
      meetName: 'Meet',
      slots: [undefined, undefined, undefined],
      teamList: [],
      meetDivisions: [],
      quizId: null,
      roomId: null,
      roomName: null,
      submittedAt: null,
    })
    const { canSubmit } = useResultSubmission(makeDeps({ allQuestionsComplete: ref(false) }))
    expect(canSubmit.value).toBe(false)
    session.clearSession()
  })

  it('is false when division or quizNumber is blank', () => {
    const session = useMeetSession()
    session.restoreSession({
      meetId: 1,
      meetName: 'Meet',
      slots: [undefined, undefined, undefined],
      teamList: [],
      meetDivisions: [],
      quizId: null,
      roomId: null,
      roomName: null,
      submittedAt: null,
    })
    const { canSubmit } = useResultSubmission(
      makeDeps({ quiz: { value: { division: '', quizNumber: '1' } } }),
    )
    expect(canSubmit.value).toBe(false)
    session.clearSession()
  })

  it('is false once submitted (lock until session is replaced)', () => {
    const session = useMeetSession()
    session.restoreSession({
      meetId: 1,
      meetName: 'Meet',
      slots: [undefined, undefined, undefined],
      teamList: [],
      meetDivisions: [],
      quizId: null,
      roomId: null,
      roomName: null,
      submittedAt: '2026-01-01T00:00:00.000Z',
    })
    const { canSubmit } = useResultSubmission(makeDeps())
    expect(canSubmit.value).toBe(false)
    session.clearSession()
  })
})

describe('useResultSubmission — submit', () => {
  function setupSession() {
    const session = useMeetSession()
    session.restoreSession({
      meetId: 42,
      meetName: 'Finals',
      slots: [undefined, undefined, undefined],
      teamList: [],
      meetDivisions: [],
      quizId: 777,
      roomId: 9,
      roomName: 'Sanctuary',
      submittedAt: null,
    })
    return session
  }

  it('posts quizFile + quizId + roomId and marks submitted on success', async () => {
    const session = setupSession()
    vi.mocked(postResult).mockResolvedValueOnce({ id: 1, submittedAt: 'now' })
    const { submit } = useResultSubmission(makeDeps())

    const outcome = await submit()
    expect(outcome).toEqual({ ok: true })
    expect(postResult).toHaveBeenCalledWith(42, {
      quizFile: makeQuizFile(),
      quizId: 777,
      roomId: 9,
    })
    expect(session.isSubmitted.value).toBe(true)
    session.clearSession()
  })

  it('surfaces 409 as { ok: false, duplicate: true } without marking submitted', async () => {
    const session = setupSession()
    vi.mocked(postResult).mockRejectedValueOnce(new ApiError(409, 'already exists'))
    const { submit } = useResultSubmission(makeDeps())

    const outcome = await submit()
    expect(outcome).toEqual({ ok: false, duplicate: true })
    expect(session.isSubmitted.value).toBe(false)
    session.clearSession()
  })

  it('surfaces other errors via submitError', async () => {
    const session = setupSession()
    vi.mocked(postResult).mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { submit, submitError } = useResultSubmission(makeDeps())

    const outcome = await submit()
    expect(outcome.ok).toBe(false)
    expect(submitError.value).toBe('boom')
    expect(session.isSubmitted.value).toBe(false)
    session.clearSession()
  })

  it('skips the post when canSubmit is false', async () => {
    // No meet session active — canSubmit is false.
    const { submit } = useResultSubmission(makeDeps())
    const outcome = await submit()
    expect(outcome).toEqual({ ok: false })
    expect(postResult).not.toHaveBeenCalled()
  })

  it('toggles submitting around the post', async () => {
    setupSession()
    let resolvePost!: (v: { id: number; submittedAt: string }) => void
    vi.mocked(postResult).mockReturnValueOnce(
      new Promise((r) => {
        resolvePost = r
      }),
    )
    const { submit, submitting } = useResultSubmission(makeDeps())

    const promise = submit()
    expect(submitting.value).toBe(true)
    resolvePost({ id: 1, submittedAt: 'now' })
    await promise
    expect(submitting.value).toBe(false)
    useMeetSession().clearSession()
  })
})
