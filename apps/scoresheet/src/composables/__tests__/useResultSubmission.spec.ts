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

function activateSession(
  overrides: Partial<Parameters<ReturnType<typeof useMeetSession>['restoreSession']>[0]> = {},
) {
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
    serverSaveEnabled: true,
    submittedAt: null,
    ...overrides,
  })
  return session
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(postResult).mockReset()
})

describe('useResultSubmission — canSubmit', () => {
  it('false without meet session', () => {
    const { canSubmit } = useResultSubmission(makeDeps())
    expect(canSubmit.value).toBe(false)
  })

  it('true with valid + complete + meet binding', () => {
    activateSession()
    const { canSubmit } = useResultSubmission(makeDeps())
    expect(canSubmit.value).toBe(true)
    useMeetSession().clearSession()
  })

  it('false when there are validation errors', () => {
    activateSession()
    const { canSubmit } = useResultSubmission(makeDeps({ hasAnyErrors: ref(true) }))
    expect(canSubmit.value).toBe(false)
    useMeetSession().clearSession()
  })

  it('false when incomplete', () => {
    activateSession()
    const { canSubmit } = useResultSubmission(makeDeps({ allQuestionsComplete: ref(false) }))
    expect(canSubmit.value).toBe(false)
    useMeetSession().clearSession()
  })

  it('false when meta is blank', () => {
    activateSession()
    const { canSubmit } = useResultSubmission(
      makeDeps({ quiz: { value: { division: '', quizNumber: '1' } } }),
    )
    expect(canSubmit.value).toBe(false)
    useMeetSession().clearSession()
  })

  it('false once submitted', () => {
    activateSession({ submittedAt: '2026-05-23T00:00:00.000Z' })
    const { canSubmit } = useResultSubmission(makeDeps())
    expect(canSubmit.value).toBe(false)
    useMeetSession().clearSession()
  })
})

describe('useResultSubmission — submit', () => {
  it('posts quizFile + quizId + roomId and marks submitted', async () => {
    const session = activateSession()
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

  it('surfaces 409 as duplicate without marking submitted', async () => {
    const session = activateSession()
    vi.mocked(postResult).mockRejectedValueOnce(new ApiError(409, 'already exists'))
    const { submit } = useResultSubmission(makeDeps())
    const outcome = await submit()
    expect(outcome).toEqual({ ok: false, duplicate: true })
    expect(session.isSubmitted.value).toBe(false)
    session.clearSession()
  })

  it('surfaces other errors via submitError', async () => {
    const session = activateSession()
    vi.mocked(postResult).mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { submit, submitError } = useResultSubmission(makeDeps())
    const outcome = await submit()
    expect(outcome.ok).toBe(false)
    expect(submitError.value).toBe('boom')
    expect(session.isSubmitted.value).toBe(false)
    session.clearSession()
  })

  it('skips the post when canSubmit is false', async () => {
    const { submit } = useResultSubmission(makeDeps())
    const outcome = await submit()
    expect(outcome).toEqual({ ok: false })
    expect(postResult).not.toHaveBeenCalled()
  })
})
