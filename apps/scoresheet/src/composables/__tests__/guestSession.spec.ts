import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MeetRole } from '@qzr/shared'

vi.mock('../../api', () => ({
  joinMeetGuest: vi.fn(),
}))

import { joinMeetGuest } from '../../api'
import {
  initGuestSession,
  setGuestSession,
  guestSessionRef,
  getGuestToken,
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
  setGuestSession(null)
  vi.clearAllMocks()
  setSearch('')
})

afterEach(() => {
  setGuestSession(null)
})

describe('initGuestSession — URL parsing', () => {
  it('returns null and does not call API when ?meet= is absent', async () => {
    setSearch('')
    const result = await initGuestSession()
    expect(result).toBeNull()
    expect(joinMeetGuest).not.toHaveBeenCalled()
    expect(guestSessionRef.value).toBeNull()
  })

  it('parses ?meet=<slug> and posts to /api/join/guest', async () => {
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
      slug: 'fall-2025',
    })
    expect(guestSessionRef.value?.token).toBe('tok-abc')
    expect(getGuestToken()).toBe('tok-abc')
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
    // Still just the one call after all three settled.
    expect(joinMeetGuest).toHaveBeenCalledTimes(1)
  })

  it('ignores a non-viewer response (security gate)', async () => {
    setSearch('?meet=fall-2025')
    vi.mocked(joinMeetGuest).mockResolvedValue({
      token: 'tok-x',
      meet: { id: 1, name: 'X' },
      role: 'admin',
    })
    const result = await initGuestSession()
    expect(result).toBeNull()
    expect(guestSessionRef.value).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('returns null when the join request fails', async () => {
    setSearch('?meet=does-not-exist')
    vi.mocked(joinMeetGuest).mockResolvedValue(null)
    const result = await initGuestSession()
    expect(result).toBeNull()
    expect(guestSessionRef.value).toBeNull()
  })
})
