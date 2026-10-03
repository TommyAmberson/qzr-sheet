import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, MeetRole, type QuizFile } from '@qzr/shared'
import { setGuestState, type GuestSessionData } from '@qzr/ui'

vi.mock('../../api', () => ({
  getMyMeets: vi.fn(),
  getSender: vi.fn(),
  submitResult: vi.fn(),
}))

import { getMyMeets, getSender, submitResult } from '../../api'
import { senderOf, useSubmitToMeet } from '../useSubmitToMeet'

const file = { version: 2 } as unknown as QuizFile

function joined(meetId: number, role: GuestSessionData['role']): GuestSessionData {
  return { token: 't', meetId, meetName: `Guest ${meetId}`, role, code: 'c' }
}

const membership = (meetId: number, role: string) => ({ meetId, meetName: `Meet ${meetId}`, role })

beforeEach(async () => {
  setGuestState(null)
  localStorage.clear()
  vi.mocked(getMyMeets).mockReset().mockRejectedValue(new ApiError(401, 'Not signed in'))
  // Forget the last test's account meets
  await useSubmitToMeet().refreshTargets()
  vi.mocked(getSender).mockReset()
  vi.mocked(submitResult).mockReset().mockResolvedValue({ revision: 1, created: true })
})

describe('the meets the user may submit to', () => {
  it("are an account's meets as admin, official or superuser, once each", async () => {
    vi.mocked(getMyMeets).mockResolvedValue({
      memberships: [
        membership(1, MeetRole.Admin),
        membership(2, MeetRole.Official),
        membership(2, MeetRole.Official),
        membership(3, MeetRole.HeadCoach),
        membership(4, MeetRole.Viewer),
        membership(5, MeetRole.Superuser),
      ],
    })
    const { targets, refreshTargets } = useSubmitToMeet()
    await refreshTargets()
    expect(targets.value.map((t) => t.meetId)).toEqual([1, 2, 5])
  })

  it('include meets joined with an official code, signed out', async () => {
    setGuestState({ active: 7, joined: [joined(7, MeetRole.Official), joined(8, MeetRole.Viewer)] })
    const { targets, refreshTargets } = useSubmitToMeet()
    await refreshTargets()
    expect(targets.value).toEqual([{ meetId: 7, meetName: 'Guest 7' }])
  })

  it('are none for someone signed out with no code', async () => {
    const { targets, refreshTargets } = useSubmitToMeet()
    await refreshTargets()
    expect(targets.value).toEqual([])
  })

  it("stay as they were when there's no telling", async () => {
    vi.mocked(getMyMeets).mockResolvedValue({ memberships: [membership(1, MeetRole.Admin)] })
    const { targets, refreshTargets } = useSubmitToMeet()
    await refreshTargets()
    vi.mocked(getMyMeets).mockRejectedValue(new Error('offline'))
    await refreshTargets()
    expect(targets.value.map((t) => t.meetId)).toEqual([1])
  })

  it("still include code-joined meets when the account's can't be fetched", async () => {
    vi.mocked(getMyMeets).mockRejectedValue(new Error('offline'))
    setGuestState({ active: 7, joined: [joined(7, MeetRole.Official)] })
    const { targets, refreshTargets } = useSubmitToMeet()
    await refreshTargets()
    expect(targets.value).toEqual([{ meetId: 7, meetName: 'Guest 7' }])
  })

  it("aren't overwritten by an older, slower refresh", async () => {
    let answerOld!: (value: { memberships: ReturnType<typeof membership>[] }) => void
    vi.mocked(getMyMeets)
      .mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValueOnce({ memberships: [membership(2, MeetRole.Admin)] })
    const { targets, refreshTargets } = useSubmitToMeet()
    const old = refreshTargets()
    await refreshTargets()
    answerOld({ memberships: [membership(1, MeetRole.Admin)] })
    await old
    expect(targets.value.map((t) => t.meetId)).toEqual([2])
  })
})

describe('the meet last submitted to', () => {
  it('is remembered', () => {
    const { lastMeetId, rememberMeet } = useSubmitToMeet()
    rememberMeet(4)
    expect(lastMeetId.value).toBe(4)
    expect(localStorage.getItem('qzr-submit-meet')).toBe('4')
  })
})

describe('who the user is at a meet', () => {
  it('comes from the API', async () => {
    const sender = { admin: false, rooms: [{ id: 5, name: 'Room 1' }] }
    vi.mocked(getSender).mockResolvedValue(sender)
    expect(await senderOf(1)).toEqual(sender)
  })

  it("is no one when they may not send, and unknown when there's no telling", async () => {
    vi.mocked(getSender).mockRejectedValueOnce(new ApiError(403, 'Not an official'))
    expect(await senderOf(1)).toBeNull()
    vi.mocked(getSender).mockRejectedValueOnce(new ApiError(401, 'Authentication required'))
    expect(await senderOf(1)).toBeNull()
    vi.mocked(getSender).mockRejectedValueOnce(new ApiError(500, 'Internal error'))
    expect(await senderOf(1)).toBeUndefined()
  })
})

describe('submitting a quiz', () => {
  it('sends it by name to the meet chosen, for the room chosen', async () => {
    const { submitQuiz } = useSubmitToMeet()
    expect(await submitQuiz(3, file, 5)).toEqual({
      stored: true,
      created: true,
      revision: 1,
      keptCurrent: false,
    })
    expect(submitResult).toHaveBeenCalledWith(3, file, 5, undefined)
  })

  it('reports a name the meet already has, and sends it again as the user chooses', async () => {
    const existing = {
      id: 77,
      name: 'D1 Q3',
      revision: 1,
      savedBy: { name: 'Room 1' },
      savedAt: '2026-10-02T10:00:00.000Z',
    }
    vi.mocked(submitResult).mockRejectedValueOnce(
      new ApiError(409, 'D1 Q3 was already submitted', { existing }),
    )
    const { submitQuiz } = useSubmitToMeet()
    expect(await submitQuiz(3, file, 5)).toEqual({ stored: false, existing })

    vi.mocked(submitResult).mockResolvedValueOnce({
      revision: 2,
      created: false,
      keptCurrent: true,
    })
    expect(await submitQuiz(3, file, 5, 'keepCurrent')).toEqual({
      stored: true,
      created: false,
      revision: 2,
      keptCurrent: true,
    })
    expect(submitResult).toHaveBeenLastCalledWith(3, file, 5, 'keepCurrent')
  })

  it('passes other failures on', async () => {
    vi.mocked(submitResult).mockRejectedValueOnce(new Error('offline'))
    const { submitQuiz } = useSubmitToMeet()
    await expect(submitQuiz(3, file, 5)).rejects.toThrow('offline')
  })
})
