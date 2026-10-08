import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError, MeetRole } from '@qzr/shared'

vi.mock('../../api', () => ({
  joinMeetGuest: vi.fn(),
}))

import { joinMeetGuest } from '../../api'
// The guest session module lives in @qzr/ui; the scoresheet's wrappers pass it the join call
import { initGuestSession, joinByCode } from '../useGuestSession'
import {
  addJoinedSession,
  setGuestState,
  setActiveSession,
  guestStateRef,
  getActiveSession,
  guestNotice,
  joinedSession,
  STORAGE_KEY,
  withGuestToken,
  upgradeGuestAccount,
  upgradeOnSignIn,
  withRoomCode,
  clearGuestData,
  leaveGuestMeet,
  SUBMIT_MEET_KEY,
  TEAM_NAMES_KEY,
  type RoomCodeRequest,
} from '@qzr/ui/src/guestSession'

/**
 * `initGuestSession()` reads `window.location.search`, but jsdom's location is
 * read-only. Stub it on globalThis for the duration of each test instead.
 */
function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  localStorage.clear()
  setGuestState(null)
  guestNotice.value = null
  vi.clearAllMocks()
  setSearch('')
})

afterEach(() => {
  setGuestState(null)
})

describe('initGuestSession — URL parsing', () => {
  it('returns null and does not call API when ?meet= is absent', async () => {
    setSearch('')
    const result = await initGuestSession()
    expect(result).toBeNull()
    expect(joinMeetGuest).not.toHaveBeenCalled()
    expect(guestStateRef.value.joined).toEqual([])
    expect(guestStateRef.value.active).toBeNull()
  })

  it('parses ?meet=<slug>, joins, and makes the new session active', async () => {
    setSearch('?meet=fall-2025')
    vi.mocked(joinMeetGuest).mockResolvedValue({
      token: 'tok-abc',
      meet: { id: 7, name: 'Fall 2025' },
      role: MeetRole.Viewer,
    })
    const result = await initGuestSession()
    expect(joinMeetGuest).toHaveBeenCalledWith('fall-2025')
    expect(result).toEqual({
      token: 'tok-abc',
      meetId: 7,
      meetName: 'Fall 2025',
      role: MeetRole.Viewer,
      code: 'fall-2025',
    })
    expect(getActiveSession()?.meetId).toBe(7)
    expect(getActiveSession()?.token ?? null).toBe('tok-abc')
  })

  it('rejects non-viewer roles via URL (security: shareable links → viewers only)', async () => {
    setSearch('?meet=room-code')
    vi.mocked(joinMeetGuest).mockResolvedValue({
      token: 'tok-x',
      meet: { id: 1, name: 'X' },
      role: MeetRole.Official,
    })
    const result = await initGuestSession()
    expect(result).toBeNull()
    expect(guestStateRef.value.joined).toEqual([])
  })
})

describe('initGuestSession — idempotency / race', () => {
  it('coalesces concurrent calls into a single join request', async () => {
    setSearch('?meet=fall-2025')
    let resolveJoin: (v: {
      token: string
      meet: { id: number; name: string }
      role: string
    }) => void = () => {}
    vi.mocked(joinMeetGuest).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve
        }),
    )

    const a = initGuestSession()
    const b = initGuestSession()
    const c = initGuestSession()
    expect(joinMeetGuest).toHaveBeenCalledTimes(1)

    resolveJoin({
      token: 'tok-xyz',
      meet: { id: 11, name: 'Race Meet' },
      role: MeetRole.Viewer,
    })

    const [ra, rb, rc] = await Promise.all([a, b, c])
    expect(ra).toEqual(rb)
    expect(rb).toEqual(rc)
    expect(ra?.meetId).toBe(11)
    expect(joinMeetGuest).toHaveBeenCalledTimes(1)
  })

  it('returns null when the join request fails', async () => {
    setSearch('?meet=does-not-exist')
    vi.mocked(joinMeetGuest).mockRejectedValue(new ApiError(404, 'Invalid code'))
    const result = await initGuestSession()
    expect(result).toBeNull()
    expect(guestStateRef.value.joined).toEqual([])
  })
})

describe('joinByCode — typed-in form', () => {
  it('adds a viewer-code session without making it active', async () => {
    // Plant an existing active session so we can verify joinByCode doesn't change it.
    setGuestState({
      active: 7,
      joined: [
        {
          token: 'old',
          meetId: 7,
          meetName: 'Old Meet',
          role: MeetRole.Viewer,
          code: 'old-code',
        },
      ],
    })
    vi.mocked(joinMeetGuest).mockResolvedValue({
      token: 'tok-new',
      meet: { id: 8, name: 'New Meet' },
      role: MeetRole.Viewer,
    })
    const result = await joinByCode('new-code')
    expect(result?.meetId).toBe(8)
    expect(guestStateRef.value.joined).toHaveLength(2)
    expect(guestStateRef.value.active).toBe(7)
    expect(getActiveSession()?.token ?? null).toBe('old')
  })

  it('accepts an official-code session, keeping its room and not its code', async () => {
    vi.mocked(joinMeetGuest).mockResolvedValue({
      token: 'tok-off',
      meet: { id: 5, name: 'Meet 5' },
      role: MeetRole.Official,
      room: { id: 12, name: 'Room 3' },
    })
    const result = await joinByCode('OFFICIAL-CODE-123')
    expect(result?.role).toBe(MeetRole.Official)
    const stored = guestStateRef.value.joined[0]!
    expect(stored).toMatchObject({ role: MeetRole.Official, room: { id: 12, name: 'Room 3' } })
    expect(stored).not.toHaveProperty('code')
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('OFFICIAL-CODE-123')
  })

  it('keeps the code of a viewer session', async () => {
    vi.mocked(joinMeetGuest).mockResolvedValue({
      token: 'tok-v',
      meet: { id: 6, name: 'Meet 6' },
      role: MeetRole.Viewer,
    })
    await joinByCode('viewer-slug')
    expect(guestStateRef.value.joined[0]).toMatchObject({ code: 'viewer-slug' })
  })

  it("passes on the server's refusal of an invalid code", async () => {
    vi.mocked(joinMeetGuest).mockRejectedValue(new ApiError(404, 'Invalid code'))
    await expect(joinByCode('nope')).rejects.toThrow('Invalid code')
    expect(guestStateRef.value.joined).toEqual([])
  })

  it('replaces a duplicate by meetId rather than adding a second entry', async () => {
    vi.mocked(joinMeetGuest).mockResolvedValueOnce({
      token: 'tok-a',
      meet: { id: 3, name: 'M' },
      role: MeetRole.Viewer,
    })
    await joinByCode('code-a')
    vi.mocked(joinMeetGuest).mockResolvedValueOnce({
      token: 'tok-b',
      meet: { id: 3, name: 'M' },
      role: MeetRole.Viewer,
    })
    await joinByCode('code-a')
    expect(guestStateRef.value.joined).toHaveLength(1)
    expect(guestStateRef.value.joined[0]?.token).toBe('tok-b')
  })

  it('trims whitespace before joining', async () => {
    vi.mocked(joinMeetGuest).mockResolvedValue({
      token: 't',
      meet: { id: 1, name: 'M' },
      role: MeetRole.Viewer,
    })
    await joinByCode('  spaced  ')
    expect(joinMeetGuest).toHaveBeenCalledWith('spaced')
  })
})

describe('setActiveSession', () => {
  it('switches the active session among joined meets', () => {
    setGuestState({
      active: 1,
      joined: [
        { token: 't1', meetId: 1, meetName: 'A', role: MeetRole.Viewer, code: 'a' },
        { token: 't2', meetId: 2, meetName: 'B', role: MeetRole.Viewer, code: 'b' },
      ],
    })
    expect(getActiveSession()?.token ?? null).toBe('t1')
    setActiveSession(2)
    expect(getActiveSession()?.token ?? null).toBe('t2')
  })

  it('is a no-op when meetId is not in the joined list', () => {
    setGuestState({
      active: 1,
      joined: [{ token: 't1', meetId: 1, meetName: 'A', role: MeetRole.Viewer, code: 'a' }],
    })
    setActiveSession(99)
    expect(guestStateRef.value.active).toBe(1)
  })

  it('clears the active marker when called with null', () => {
    setGuestState({
      active: 1,
      joined: [{ token: 't1', meetId: 1, meetName: 'A', role: MeetRole.Viewer, code: 'a' }],
    })
    setActiveSession(null)
    expect(getActiveSession()?.token ?? null).toBeNull()
  })
})

describe('ending guest sessions', () => {
  const session = (meetId: number) => ({
    token: `t${meetId}`,
    meetId,
    meetName: `Meet ${meetId}`,
    role: MeetRole.Viewer as const,
    code: `c${meetId}`,
  })

  it('clears every guest session and the meet data kept for guest use, and nothing else', () => {
    setGuestState({ active: 1, joined: [session(1), session(2)] })
    localStorage.setItem(TEAM_NAMES_KEY, '{"meetId":1,"lists":[]}')
    localStorage.setItem(SUBMIT_MEET_KEY, '1')
    localStorage.setItem('qzr-theme', 'dark')
    clearGuestData()
    expect(guestStateRef.value).toEqual({ active: null, joined: [] })
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(TEAM_NAMES_KEY)).toBeNull()
    expect(localStorage.getItem(SUBMIT_MEET_KEY)).toBeNull()
    expect(localStorage.getItem('qzr-theme')).toBe('dark')
  })

  it('leaves one meet, keeping the others', () => {
    setGuestState({ active: 1, joined: [session(1), session(2)] })
    leaveGuestMeet(1)
    expect(guestStateRef.value.joined.map((j) => j.meetId)).toEqual([2])
    expect(guestStateRef.value.active).toBeNull()
    leaveGuestMeet(2)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('persistence', () => {
  it("drops an official session's code saved by an earlier release, and saves the cleaned state", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        active: 4,
        joined: [
          { token: 'tok', meetId: 4, meetName: 'M', role: MeetRole.Official, code: 'ROOM-CODE' },
          { token: 'tv', meetId: 5, meetName: 'V', role: MeetRole.Viewer, code: 'view-slug' },
        ],
      }),
    )
    vi.resetModules()
    const fresh = await import('@qzr/ui/src/guestSession')
    const [official, viewer] = fresh.guestStateRef.value.joined
    expect(official).toMatchObject({ token: 'tok', meetId: 4, role: MeetRole.Official })
    expect(official).not.toHaveProperty('code')
    expect(viewer).toMatchObject({ code: 'view-slug' })
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('ROOM-CODE')
    expect(localStorage.getItem(STORAGE_KEY)).toContain('view-slug')
  })

  it('keeps the sessions it read when the cleaned state cannot be saved', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        active: 4,
        joined: [
          { token: 'tok', meetId: 4, meetName: 'M', role: MeetRole.Official, code: 'ROOM-CODE' },
        ],
      }),
    )
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    vi.resetModules()
    const fresh = await import('@qzr/ui/src/guestSession')
    write.mockRestore()
    expect(fresh.guestStateRef.value.joined).toEqual([
      { token: 'tok', meetId: 4, meetName: 'M', role: MeetRole.Official },
    ])
  })

  it('signs out of guest sessions when storage is blocked', () => {
    setGuestState({
      active: 1,
      joined: [{ token: 't', meetId: 1, meetName: 'M', role: MeetRole.Viewer, code: 'c' }],
    })
    const blocked = () => {
      throw new DOMException('Blocked', 'SecurityError')
    }
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    expect(() => clearGuestData()).not.toThrow()
    remove.mockRestore()
    write.mockRestore()
    expect(guestStateRef.value.joined).toEqual([])
  })

  it('removes the storage key entirely once cleared', () => {
    setGuestState({
      active: 1,
      joined: [{ token: 't', meetId: 1, meetName: 'M', role: MeetRole.Viewer, code: 'c' }],
    })
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy()
    setGuestState(null)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('withGuestToken: which token a request carries', () => {
  const session = (meetId: number, token: string) => ({
    token,
    meetId,
    meetName: `Meet ${meetId}`,
    role: MeetRole.Official as const,
  })
  /** The token a request for `path` carries, or null */
  async function tokenSentFor(path: string, meetId?: number): Promise<string | null> {
    const base = vi.fn(async (_path: string, init?: RequestInit) => init)
    const init = (await withGuestToken(asBase(base), vi.fn())(path, undefined, meetId)) as
      | { headers?: { Authorization?: string } }
      | undefined
    return init?.headers?.Authorization?.replace('Bearer ', '') ?? null
  }

  beforeEach(() => {
    setGuestState({
      active: 1,
      joined: [session(1, tokenExpiring(3600, 'one')), session(2, tokenExpiring(3600, 'two'))],
    })
  })

  it("sends a meet's own token for its paths, whichever meet is active", async () => {
    expect(await tokenSentFor('/api/meets/2/teams')).toBe(joinedSession(2)!.token)
    expect(await tokenSentFor('/api/meets/2')).toBe(joinedSession(2)!.token)
    expect(await tokenSentFor('/api/meets/1/results')).toBe(joinedSession(1)!.token)
  })

  it("sends no token to a meet the guest hasn't joined", async () => {
    expect(await tokenSentFor('/api/meets/3/teams')).toBeNull()
  })

  it("sends the active session's token for paths outside a meet", async () => {
    expect(await tokenSentFor('/api/teams/7/quizzers')).toBe(joinedSession(1)!.token)
  })

  it("sends a given meet's token for a path that doesn't name it", async () => {
    expect(await tokenSentFor('/api/teams/7/quizzers', 2)).toBe(joinedSession(2)!.token)
    expect(await tokenSentFor('/api/teams/7/quizzers', 3)).toBeNull()
  })
})

/** A mock API client, typed as the generic one `withGuestToken` wraps */
const asBase = (fn: unknown) => fn as Parameters<typeof withGuestToken>[0]

/** A JWT whose payload expires `secondsFromNow` from now; the signature is never checked here */
function tokenExpiring(secondsFromNow: number, id = 'x'): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow, id }))
  return `h.${payload.replace(/=+$/, '')}.s`
}

describe('withGuestToken: renewing a viewer session', () => {
  const viewer = (token: string) => ({
    token,
    meetId: 7,
    meetName: 'Fall Meet',
    role: MeetRole.Viewer as const,
    code: 'fall-2025',
  })
  const fresh = tokenExpiring(3600, 'fresh')
  const answer = { token: fresh, meet: { id: 7, name: 'Fall Meet' }, role: MeetRole.Viewer }

  it('re-joins from the kept code before a request when the token is known to have expired', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(-60))] })
    const join = vi.fn(async () => answer)
    const base = vi.fn(async () => 'ok')
    const request = withGuestToken(asBase(base), join)
    expect(await request('/api/meets/7/teams')).toBe('ok')
    expect(join).toHaveBeenCalledWith('fall-2025')
    expect(base).toHaveBeenCalledWith('/api/meets/7/teams', {
      headers: { Authorization: `Bearer ${fresh}` },
    })
  })

  it('re-joins and retries once when a request carrying a viewer token is refused with 401', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(3600, 'old'))] })
    const join = vi.fn(async () => answer)
    const base = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, 'Authentication required'))
      .mockResolvedValueOnce('ok')
    expect(await withGuestToken(asBase(base), join)('/api/meets/7/teams')).toBe('ok')
    expect(base).toHaveBeenCalledTimes(2)
    expect(joinedSession(7)?.token).toBe(fresh)
  })

  it('renews once for requests sent together', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(-60))] })
    const join = vi.fn(async () => answer)
    const base = vi.fn(async () => 'ok')
    const request = withGuestToken(asBase(base), join)
    await Promise.all([request('/api/meets/7/teams'), request('/api/meets/7/rooms')])
    expect(join).toHaveBeenCalledTimes(1)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('removes the session and reports it when the server rejects the re-join', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(3600))] })
    const join = vi.fn().mockRejectedValue(new ApiError(404, 'Invalid code'))
    const base = vi.fn().mockRejectedValue(new ApiError(401, 'Authentication required'))
    await expect(withGuestToken(asBase(base), join)('/api/meets/7/teams')).rejects.toThrow()
    expect(joinedSession(7)).toBeNull()
    expect(guestNotice.value).toContain('Fall Meet')
  })

  it('removes the session when the kept code now opens a different meet', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(-60))] })
    const join = vi.fn(async () => ({ ...answer, meet: { id: 9, name: 'Other Meet' } }))
    const base = vi.fn(async () => 'ok')
    await withGuestToken(asBase(base), join)('/api/meets/7/teams')
    expect(joinedSession(7)).toBeNull()
    expect(joinedSession(9)).toBeNull()
  })

  it('never treats a network failure as a refusal', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(3600))] })
    const join = vi.fn()
    const base = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(withGuestToken(asBase(base), join)('/api/meets/7/teams')).rejects.toThrow(
      'Failed to fetch',
    )
    expect(join).not.toHaveBeenCalled()
    expect(joinedSession(7)).not.toBeNull()
  })

  it.each([
    ['a server error', new ApiError(503, 'Service Unavailable')],
    ['a rate limit', new ApiError(429, 'Too many requests')],
  ])('keeps the session, and sends with its token, when the re-join meets %s', async (_, error) => {
    const old = tokenExpiring(60, 'old')
    setGuestState({ active: 7, joined: [viewer(old)] })
    const join = vi.fn().mockRejectedValue(error)
    const base = vi.fn(async () => 'ok')
    expect(await withGuestToken(asBase(base), join)('/api/meets/7/teams')).toBe('ok')
    expect(base).toHaveBeenCalledWith('/api/meets/7/teams', {
      headers: { Authorization: `Bearer ${old}` },
    })
    expect(joinedSession(7)?.token).toBe(old)
    expect(guestNotice.value).toBeNull()
  })

  it('throws the 401 it had when the re-join after it fails', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(3600))] })
    const refused = new ApiError(401, 'Authentication required')
    const join = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const base = vi.fn().mockRejectedValue(refused)
    await expect(withGuestToken(asBase(base), join)('/api/meets/7/teams')).rejects.toBe(refused)
    expect(joinedSession(7)).not.toBeNull()
  })

  it('brings back no session ended while it was renewing', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(-60))] })
    let answerJoin!: (a: typeof answer) => void
    const join = vi.fn(() => new Promise<typeof answer>((resolve) => (answerJoin = resolve)))
    const sent = withGuestToken(asBase(vi.fn(async () => 'ok')), join)('/api/meets/7/teams')
    await vi.waitFor(() => expect(join).toHaveBeenCalled())
    // Signed out meanwhile
    setGuestState(null)
    answerJoin(answer)
    await sent
    expect(joinedSession(7)).toBeNull()
    expect(guestNotice.value).toBeNull()
  })

  it('keeps a session joined while it was renewing', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(-60))] })
    let answerJoin!: (a: typeof answer) => void
    const join = vi.fn(() => new Promise<typeof answer>((resolve) => (answerJoin = resolve)))
    const base = vi.fn(async () => 'ok')
    const sent = withGuestToken(asBase(base), join)('/api/meets/7/teams')
    await vi.waitFor(() => expect(join).toHaveBeenCalled())
    // Joined again with a room code meanwhile
    const official = {
      token: 'official-token',
      meetId: 7,
      meetName: 'Fall Meet',
      role: MeetRole.Official as const,
      room: { id: 3, name: 'Room 1' },
    }
    addJoinedSession(official, true)
    answerJoin(answer)
    await sent
    expect(joinedSession(7)).toEqual(official)
    expect(base).toHaveBeenCalledWith('/api/meets/7/teams', {
      headers: { Authorization: 'Bearer official-token' },
    })
  })

  it('never renews after a 401 to a request about no meet', async () => {
    setGuestState({ active: 7, joined: [viewer(tokenExpiring(3600))] })
    const join = vi.fn(async () => answer)
    const base = vi.fn().mockRejectedValue(new ApiError(401, 'Authentication required'))
    await expect(withGuestToken(asBase(base), join)('/api/my-meets')).rejects.toThrow()
    expect(join).not.toHaveBeenCalled()
    expect(base).toHaveBeenCalledTimes(1)
  })
})

/** The room-code dialog, answering each row from `codes` by its label; a missing one is skipped */
function dialogAnswering(codes: Record<string, string>) {
  const told: Record<string, string | null> = {}
  return {
    told,
    ask: vi.fn(async (req: RoomCodeRequest) => {
      let all = true
      for (const row of req.rows) {
        const code = codes[row.label]
        if (code === undefined) {
          all = false
          continue
        }
        told[row.label] = await req.onCode(row, code)
        if (told[row.label] !== null) all = false
      }
      return all
    }),
  }
}

describe('withRoomCode: renewing an official session around an action', () => {
  const official = (token: string) => ({
    token,
    meetId: 4,
    meetName: 'Spring Meet',
    role: MeetRole.Official as const,
    room: { id: 12, name: 'Room 3' },
  })
  const newToken = tokenExpiring(3600, 'renewed')
  const officialAnswer = {
    token: newToken,
    meet: { id: 4, name: 'Spring Meet' },
    role: MeetRole.Official,
    room: { id: 12, name: 'Room 3' },
  }
  /** A dialog that types `code` into the room's row, or is cancelled when `code` is null */
  const dialogTyping = (code: string | null) =>
    dialogAnswering(code === null ? {} : { 'Spring Meet, Room 3': code })

  it('asks for the code before running when the session is known to have expired', async () => {
    setGuestState({ active: 4, joined: [official(tokenExpiring(-60))] })
    const dialog = dialogTyping('NEW-CODE')
    const action = vi.fn(async () => 'stored')
    const join = vi.fn(async () => officialAnswer)
    expect(await withRoomCode(4, action, { join, dialog, signedIn: false })).toBe('stored')
    expect(dialog.ask).toHaveBeenCalledTimes(1)
    expect(join).toHaveBeenCalledWith('NEW-CODE')
    expect(joinedSession(4)).toMatchObject({ token: newToken, room: { id: 12, name: 'Room 3' } })
    expect(joinedSession(4)).not.toHaveProperty('code')
  })

  it('asks, re-joins, and runs the action once more when it is refused with 401', async () => {
    setGuestState({ active: 4, joined: [official(tokenExpiring(3600))] })
    const dialog = dialogTyping('NEW-CODE')
    const action = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, 'Authentication required'))
      .mockResolvedValueOnce('stored')
    const join = vi.fn(async () => officialAnswer)
    expect(await withRoomCode(4, action, { join, dialog, signedIn: false })).toBe('stored')
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('leaves the action unrun when the dialog is cancelled', async () => {
    setGuestState({ active: 4, joined: [official(tokenExpiring(-60))] })
    const action = vi.fn()
    const result = await withRoomCode(4, action, {
      join: vi.fn(),
      dialog: dialogTyping(null),
      signedIn: false,
    })
    expect(result).toBeUndefined()
    expect(action).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a code that opens nothing',
      () => Promise.reject(new ApiError(404, 'Invalid code')),
      "isn't a room code",
    ],
    [
      'a code for another meet',
      async () => ({ ...officialAnswer, meet: { id: 9, name: 'Other' } }),
      'another meet',
    ],
    ['a viewer code', async () => ({ ...officialAnswer, role: MeetRole.Viewer }), 'room code'],
    [
      "another room's code",
      async () => ({ ...officialAnswer, room: { id: 15, name: 'Room 5' } }),
      "Room 5; enter Room 3's code",
    ],
  ])('refuses %s on the row, storing and replacing nothing', async (_, join, message) => {
    const old = official(tokenExpiring(-60, 'old'))
    setGuestState({ active: 4, joined: [old] })
    const dialog = dialogTyping('WRONG')
    const action = vi.fn()
    await withRoomCode(4, action, { join, dialog, signedIn: false })
    expect(dialog.told['Spring Meet, Room 3']).toContain(message)
    expect(action).not.toHaveBeenCalled()
    expect(guestStateRef.value.joined).toEqual([old])
  })

  it('asks nothing in the minutes before the token runs out', async () => {
    setGuestState({ active: 4, joined: [official(tokenExpiring(60))] })
    const dialog = dialogTyping('NEW-CODE')
    const action = vi.fn(async () => 'stored')
    expect(await withRoomCode(4, action, { join: vi.fn(), dialog, signedIn: false })).toBe('stored')
    expect(dialog.ask).not.toHaveBeenCalled()
  })

  it('never takes a server error on the code for a refusal', async () => {
    setGuestState({ active: 4, joined: [official(tokenExpiring(-60))] })
    const dialog = dialogTyping('NEW-CODE')
    const join = vi.fn().mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    await withRoomCode(4, vi.fn(), { join, dialog, signedIn: false })
    expect(dialog.told['Spring Meet, Room 3']).toMatch(/reach/)
  })

  it('asks for nothing while an account is signed in', async () => {
    setGuestState({ active: 4, joined: [official(tokenExpiring(-60))] })
    const dialog = dialogTyping('NEW-CODE')
    const action = vi.fn().mockRejectedValue(new ApiError(401, 'Authentication required'))
    await expect(
      withRoomCode(4, action, { join: vi.fn(), dialog, signedIn: true }),
    ).rejects.toThrow()
    expect(dialog.ask).not.toHaveBeenCalled()
  })

  it('never treats a network failure as a refusal', async () => {
    setGuestState({ active: 4, joined: [official(tokenExpiring(3600))] })
    const dialog = dialogTyping('NEW-CODE')
    const action = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      withRoomCode(4, action, { join: vi.fn(), dialog, signedIn: false }),
    ).rejects.toThrow('Failed to fetch')
    expect(dialog.ask).not.toHaveBeenCalled()
  })
})

describe('upgradeGuestAccount: signing in upgrades the account with the codes', () => {
  const viewer = (meetId: number, code: string) => ({
    token: tokenExpiring(3600),
    meetId,
    meetName: `Meet ${meetId}`,
    role: MeetRole.Viewer as const,
    code,
  })
  const official = (meetId: number, room: string) => ({
    token: tokenExpiring(3600),
    meetId,
    meetName: `Meet ${meetId}`,
    role: MeetRole.Official as const,
    room: { id: meetId * 10, name: room },
  })
  /** The signed-in join, answering each code for the meet and role given */
  const joinAnswering = (answers: Record<string, [number, MeetRole]>) =>
    vi.fn(async (code: string) => {
      const [id, role] = answers[code]!
      return { meet: { id, name: `Meet ${id}` }, role }
    })

  it('redeems viewer sessions with their kept code, without asking, and removes them', async () => {
    setGuestState({ active: 1, joined: [viewer(1, 'slug-one'), viewer(2, 'slug-two')] })
    const joinMeet = joinAnswering({
      'slug-one': [1, MeetRole.Viewer],
      'slug-two': [2, MeetRole.Viewer],
    })
    const dialog = dialogAnswering({})
    await upgradeGuestAccount({ joinMeet, dialog })
    expect(joinMeet.mock.calls).toEqual([['slug-one'], ['slug-two']])
    expect(dialog.ask).not.toHaveBeenCalled()
    expect(guestStateRef.value.joined).toEqual([])
  })

  it('asks for every room in one dialog, redeeming entered codes and removing skipped rooms', async () => {
    setGuestState({ active: 3, joined: [official(3, 'Room 1'), official(4, 'Room 2')] })
    const joinMeet = joinAnswering({ 'ROOM-ONE': [3, MeetRole.Official] })
    const dialog = dialogAnswering({ 'Meet 3, Room 1': 'ROOM-ONE' })
    await upgradeGuestAccount({ joinMeet, dialog })
    expect(dialog.ask).toHaveBeenCalledTimes(1)
    expect(dialog.ask.mock.calls[0]![0].rows.map((r) => r.label)).toEqual([
      'Meet 3, Room 1',
      'Meet 4, Room 2',
    ])
    expect(joinMeet.mock.calls).toEqual([['ROOM-ONE']])
    expect(guestStateRef.value.joined).toEqual([])
  })

  it('reports a wrong code on its row', async () => {
    setGuestState({ active: 3, joined: [official(3, 'Room 1')] })
    const joinMeet = vi.fn().mockRejectedValue(new ApiError(404, 'Invalid code'))
    const dialog = dialogAnswering({ 'Meet 3, Room 1': 'WRONG' })
    await upgradeGuestAccount({ joinMeet, dialog })
    expect(dialog.told['Meet 3, Room 1']).toBeTruthy()
  })

  it.each([
    ['a code for another meet', [4, MeetRole.Official] as const, 'another meet'],
    ['a viewer code', [3, MeetRole.Viewer] as const, "isn't a room code"],
  ])("refuses %s on the row, so it isn't marked added", async (_, [id, role], message) => {
    setGuestState({ active: 3, joined: [official(3, 'Room 1')] })
    const dialog = dialogAnswering({ 'Meet 3, Room 1': 'OTHER' })
    await upgradeGuestAccount({ joinMeet: joinAnswering({ OTHER: [id, role] }), dialog })
    expect(dialog.told['Meet 3, Room 1']).toContain(message)
  })

  it('removes a viewer session whose code now opens another meet, saying it was added', async () => {
    setGuestState({ active: 1, joined: [viewer(1, 'reused-slug')] })
    const joinMeet = joinAnswering({ 'reused-slug': [9, MeetRole.Viewer] })
    await upgradeGuestAccount({ joinMeet, dialog: dialogAnswering({}) })
    expect(guestStateRef.value.joined).toEqual([])
    expect(guestNotice.value).toBe(
      'The code for Meet 1 now opens Meet 9; Meet 9 was added to your account.',
    )
  })

  it("keeps a room whose code couldn't reach the server when the dialog is closed", async () => {
    const room = official(3, 'Room 1')
    setGuestState({ active: 3, joined: [room, official(4, 'Room 2')] })
    const joinMeet = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const dialog = dialogAnswering({ 'Meet 3, Room 1': 'ROOM-ONE' })
    await upgradeGuestAccount({ joinMeet, dialog })
    expect(dialog.told['Meet 3, Room 1']).toMatch(/reach/)
    expect(guestStateRef.value.joined).toEqual([room])
  })

  it('asks once when a room is kept for later and another skipped', async () => {
    setGuestState({ active: 3, joined: [official(3, 'Room 1'), official(4, 'Room 2')] })
    const joinMeet = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const dialog = dialogAnswering({ 'Meet 3, Room 1': 'ROOM-ONE' })
    const wrapper = mount(
      defineComponent({
        setup() {
          upgradeOnSignIn(
            () => 'user-1',
            () => ({ joinMeet, dialog }),
          )
          return () => null
        },
      }),
    )
    await flushPromises()
    expect(dialog.ask).toHaveBeenCalledTimes(1)
    expect(guestStateRef.value.joined.map((j) => j.meetId)).toEqual([3])
    wrapper.unmount()
  })

  it('keeps every session for later when the server cannot be reached', async () => {
    const sessions = [viewer(1, 'slug-one'), official(3, 'Room 1')]
    setGuestState({ active: 1, joined: sessions })
    const joinMeet = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const dialog = dialogAnswering({})
    await upgradeGuestAccount({ joinMeet, dialog })
    expect(guestStateRef.value.joined).toEqual(sessions)
    expect(dialog.ask).not.toHaveBeenCalled()
  })

  it('removes a viewer session whose code no longer works, and says so', async () => {
    setGuestState({ active: 1, joined: [viewer(1, 'old-slug')] })
    const joinMeet = vi.fn().mockRejectedValue(new ApiError(404, 'Invalid code'))
    await upgradeGuestAccount({ joinMeet, dialog: dialogAnswering({}) })
    expect(guestStateRef.value.joined).toEqual([])
    expect(guestNotice.value).toContain('Meet 1')
  })

  it('keeps a viewer session when the server fails on its code', async () => {
    const session = viewer(1, 'slug-one')
    setGuestState({ active: 1, joined: [session] })
    const joinMeet = vi.fn().mockRejectedValue(new ApiError(500, 'Internal Server Error'))
    await upgradeGuestAccount({ joinMeet, dialog: dialogAnswering({}) })
    expect(guestStateRef.value.joined).toEqual([session])
    expect(guestNotice.value).toBeNull()
  })

  it('upgrades a meet joined while an upgrade was running', async () => {
    setGuestState({ active: 3, joined: [official(3, 'Room 1')] })
    const joinMeet = joinAnswering({ 'slug-one': [1, MeetRole.Viewer] })
    // A meet link's join finishes while the rooms dialog is open
    const dialog = {
      ask: vi.fn(async () => {
        setGuestState({
          active: 3,
          joined: [...guestStateRef.value.joined, viewer(1, 'slug-one')],
        })
        return false
      }),
    }
    await upgradeGuestAccount({ joinMeet, dialog })
    expect(joinMeet).toHaveBeenCalledWith('slug-one')
    expect(guestStateRef.value.joined).toEqual([])
  })

  it('upgrades a meet joined while signed in, as a link joining after start', async () => {
    const joinMeet = joinAnswering({ 'slug-one': [1, MeetRole.Viewer] })
    const wrapper = mount(
      defineComponent({
        setup() {
          upgradeOnSignIn(
            () => 'user-1',
            () => ({ joinMeet, dialog: dialogAnswering({}) }),
          )
          return () => null
        },
      }),
    )
    await flushPromises()
    expect(joinMeet).not.toHaveBeenCalled()
    setGuestState({ active: 1, joined: [viewer(1, 'slug-one')] })
    await flushPromises()
    expect(joinMeet).toHaveBeenCalledWith('slug-one')
    expect(guestStateRef.value.joined).toEqual([])
    wrapper.unmount()
  })

  it('never sends a guest token as a code', async () => {
    setGuestState({ active: 1, joined: [viewer(1, 'slug-one'), official(3, 'Room 1')] })
    const tokens = guestStateRef.value.joined.map((j) => j.token)
    const joinMeet = joinAnswering({ 'slug-one': [1, MeetRole.Viewer] })
    await upgradeGuestAccount({ joinMeet, dialog: dialogAnswering({}) })
    const sent = joinMeet.mock.calls.map(([code]) => code)
    for (const token of tokens) expect(sent).not.toContain(token)
    expect(sent).toEqual(['slug-one'])
  })
})
