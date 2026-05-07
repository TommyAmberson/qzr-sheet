import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MeetRole } from '@qzr/shared'

vi.mock('../../api', () => ({
  joinMeetGuest: vi.fn(),
}))

import { joinMeetGuest } from '../../api'
import {
  initGuestSession,
  joinByCode,
  setGuestState,
  setActiveSession,
  guestStateRef,
  getGuestToken,
  getActiveSession,
  STORAGE_KEY,
} from '../guestSession'

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
    expect(getGuestToken()).toBe('tok-abc')
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
    vi.mocked(joinMeetGuest).mockResolvedValue(null)
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
    expect(getGuestToken()).toBe('old')
  })

  it('accepts an official-code session', async () => {
    vi.mocked(joinMeetGuest).mockResolvedValue({
      token: 'tok-off',
      meet: { id: 5, name: 'Room 1' },
      role: MeetRole.Official,
    })
    const result = await joinByCode('OFFICIAL-CODE-123')
    expect(result?.role).toBe(MeetRole.Official)
    expect(guestStateRef.value.joined[0]?.role).toBe(MeetRole.Official)
  })

  it('returns null on invalid code (404 path)', async () => {
    vi.mocked(joinMeetGuest).mockResolvedValue(null)
    const result = await joinByCode('nope')
    expect(result).toBeNull()
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
    expect(getGuestToken()).toBe('t1')
    setActiveSession(2)
    expect(getGuestToken()).toBe('t2')
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
    expect(getGuestToken()).toBeNull()
  })
})

describe('persistence', () => {
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
