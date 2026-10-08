import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { ApiError, MeetRole } from '@qzr/shared'
import { setGuestState, type RoomCodeRequest } from '@qzr/ui'

const session = ref<{ data: { user: { id: string } } | null; isPending?: boolean }>({ data: null })
const getSession = vi.fn(async () => ({ data: null as { user: { id: string } } | null }))
vi.mock('../useAuth', () => ({
  useAuth: () => ({ session }),
  authClient: { getSession: () => getSession() },
}))
vi.mock('../../api', () => ({
  joinMeetGuest: vi.fn(async () => ({
    token: 'renewed',
    meet: { id: 4, name: 'Spring Meet' },
    role: MeetRole.Official,
    room: { id: 12, name: 'Room 3' },
  })),
}))

import { roomCodeDialog, useRoomCode } from '../useRoomCode'

/** A token that hasn't expired, so nothing is asked before an action runs */
const freshToken = `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`

beforeEach(() => {
  session.value = { data: null }
  setGuestState({
    active: 4,
    joined: [
      {
        token: freshToken,
        meetId: 4,
        meetName: 'Spring Meet',
        role: MeetRole.Official,
        room: { id: 12, name: 'Room 3' },
      },
    ],
  })
})

/** The composable, with its dialog answering the one row with `code` */
function withDialogTyping(code: string) {
  const ask = vi.fn(async (req: RoomCodeRequest) => (await req.onCode(req.rows[0]!, code)) === null)
  roomCodeDialog.value = { ask } as unknown as typeof roomCodeDialog.value
  return { ...useRoomCode(), ask }
}

describe('useRoomCode', () => {
  it('asks a guest official for the room code when an action is refused, then runs it again', async () => {
    const { renew, ask } = withDialogTyping('NEW-CODE')
    const action = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, 'Authentication required'))
      .mockResolvedValueOnce('saved')
    expect(await renew(4, action)).toBe('saved')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('asks nothing while an account is signed in', async () => {
    session.value = { data: { user: { id: 'u1' } } }
    const { renew, ask } = withDialogTyping('NEW-CODE')
    const action = vi.fn().mockRejectedValue(new ApiError(401, 'Authentication required'))
    await expect(renew(4, action)).rejects.toThrow()
    expect(ask).not.toHaveBeenCalled()
  })

  it('waits for a session still loading, and asks nothing when it turns out signed in', async () => {
    session.value = { data: null, isPending: true }
    getSession.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    const { renew, ask } = withDialogTyping('NEW-CODE')
    const action = vi.fn().mockRejectedValue(new ApiError(401, 'Authentication required'))
    await expect(renew(4, action)).rejects.toThrow()
    expect(getSession).toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })
})
