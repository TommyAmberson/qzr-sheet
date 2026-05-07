import { ref } from 'vue'
import { MeetRole } from '@qzr/shared'
import { joinMeetGuest } from '../api'

/**
 * Guest session state for visitors who don't have an account. Two entry points:
 *
 * 1. Shareable URL — `/scoresheet/?meet=<viewerCode>` auto-joins as viewer on
 *    page load. Restricted to viewer codes only (the URL is shareable, so we
 *    can't trust the recipient with an official code).
 * 2. "Have a code?" form in the meet picker — accepts viewer or official
 *    codes, the user is typing them in directly.
 *
 * The session keeps a list of every meet the user has joined this way and
 * tracks which one is currently active. The API client's `request()` wrapper
 * reads the active token via `getGuestToken()` and attaches it as
 * `Authorization: Bearer`. This module is a non-`use*` module so the API
 * client can read state synchronously without going through Vue's composable
 * contract.
 */

export const STORAGE_KEY = 'qzr-guest-session'
const URL_PARAM = 'meet'
/** Skew applied to the JWT exp claim — refresh if less than this remaining. */
const REFRESH_SKEW_MS = 5 * 60 * 1000

export interface GuestSessionData {
  token: string
  meetId: number
  meetName: string
  role: MeetRole.Viewer | MeetRole.Official
  /** Code used to obtain this token (URL slug or typed-in code). */
  code: string
}

interface GuestState {
  /** meetId of the active session whose token is sent on requests. */
  active: number | null
  joined: GuestSessionData[]
}

const EMPTY_STATE: GuestState = { active: null, joined: [] }

export const guestStateRef = ref<GuestState>(loadFromStorage())

/** Synchronous accessor used by the API client wrapper. */
export function getGuestToken(): string | null {
  const s = guestStateRef.value
  if (s.active === null) return null
  return s.joined.find((j) => j.meetId === s.active)?.token ?? null
}

/** Active session (whose token would be attached to outgoing requests). */
export function getActiveSession(): GuestSessionData | null {
  const s = guestStateRef.value
  if (s.active === null) return null
  return s.joined.find((j) => j.meetId === s.active) ?? null
}

/** Replace the entire state. Pass null to clear everything (also drops the cached init promise). */
export function setGuestState(state: GuestState | null): void {
  guestStateRef.value = state ?? EMPTY_STATE
  persist()
  // Clearing also drops the cached init promise so the next initGuestSession()
  // call refetches a fresh token instead of resolving to the stale "previously
  // cleared" result.
  if (state === null) initPromise = null
}

/** Make a particular joined meet active. No-op if meetId isn't in the list (or null clears). */
export function setActiveSession(meetId: number | null): void {
  const state = guestStateRef.value
  if (meetId !== null && !state.joined.some((j) => j.meetId === meetId)) return
  guestStateRef.value = { ...state, active: meetId }
  persist()
}

/**
 * Add (or replace by meetId) a guest session in the joined list. The new
 * session is also made active when `makeActive` is true; the URL `?meet=` flow
 * passes true, the "Have a code?" form passes false.
 */
export function addJoinedSession(data: GuestSessionData, makeActive: boolean): void {
  const state = guestStateRef.value
  const filtered = state.joined.filter((j) => j.meetId !== data.meetId)
  guestStateRef.value = {
    active: makeActive ? data.meetId : state.active,
    joined: [...filtered, data],
  }
  persist()
}

/**
 * Cached promise from the first initGuestSession() call. Subsequent callers
 * await the same promise so the join round-trip happens once. App.vue kicks
 * this off at startup; consumers (e.g. MeetPickerDialog) await it before
 * branching on guest state to avoid a click-before-init race.
 */
let initPromise: Promise<GuestSessionData | null> | null = null

/**
 * Bootstrap from the URL: read `?meet=<slug>` and either reuse a fresh stored
 * session for that slug or call POST /api/join/guest. URL flow is restricted
 * to viewer codes — the link is shareable and we can't trust the recipient
 * with an official code. Safe and cheap to call multiple times — the first
 * call caches the in-flight promise and later calls await the same one.
 */
export function initGuestSession(): Promise<GuestSessionData | null> {
  if (!initPromise) initPromise = doInitGuestSession()
  return initPromise
}

async function doInitGuestSession(): Promise<GuestSessionData | null> {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const slug = params.get(URL_PARAM)?.trim()
  if (!slug) return null

  const existing = guestStateRef.value.joined.find((j) => j.code === slug)
  if (existing && tokenIsFresh(existing.token)) {
    setActiveSession(existing.meetId)
    return existing
  }

  const res = await joinMeetGuest(slug)
  if (!res || res.role !== MeetRole.Viewer) return null
  const data: GuestSessionData = {
    token: res.token,
    meetId: res.meet.id,
    meetName: res.meet.name,
    role: MeetRole.Viewer,
    code: slug,
  }
  addJoinedSession(data, true)
  return data
}

/**
 * Join a meet via a typed-in code (called from the "Have a code?" form).
 * Accepts viewer and official codes — the user is typing them in directly so
 * passing an official code is informed consent. Adds to the joined list but
 * does NOT switch the active session; the user picks the row to load it.
 */
export async function joinByCode(code: string): Promise<GuestSessionData | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  const res = await joinMeetGuest(trimmed)
  if (!res) return null
  if (res.role !== MeetRole.Viewer && res.role !== MeetRole.Official) return null
  const data: GuestSessionData = {
    token: res.token,
    meetId: res.meet.id,
    meetName: res.meet.name,
    role: res.role,
    code: trimmed,
  }
  addJoinedSession(data, false)
  return data
}

/**
 * Return true if the JWT is more than REFRESH_SKEW_MS away from expiring. We
 * never trust the exp claim for security (the server re-verifies), only to
 * decide when to skip a refresh round-trip.
 */
function tokenIsFresh(token: string): boolean {
  try {
    const segments = token.split('.')
    if (segments.length < 2) return false
    // JWT uses unpadded base64url; atob is strict about padding in some
    // engines (notably WebKit), so re-pad before decoding.
    const seg = segments[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const padded = seg + '='.repeat((4 - (seg.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as { exp?: number }
    if (typeof payload.exp !== 'number') return false
    return payload.exp * 1000 - Date.now() > REFRESH_SKEW_MS
  } catch {
    return false
  }
}

function persist(): void {
  const s = guestStateRef.value
  if (s.active === null && s.joined.length === 0) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  }
}

function loadFromStorage(): GuestState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { active: null, joined: [] }
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return { active: null, joined: [] }

    // New shape: { active, joined[] }
    if ('joined' in data && Array.isArray((data as GuestState).joined)) {
      const s = data as GuestState
      const joined = s.joined.filter(isValidSession)
      const active = s.active && joined.some((j) => j.meetId === s.active) ? s.active : null
      return { active, joined }
    }

    // Legacy shape: a single session at the top level. Wrap it as the only
    // joined entry. Pre-multi-meet sessions only ever held viewer tokens.
    const legacy = data as Partial<GuestSessionData & { slug?: string }>
    if (legacy.token && legacy.meetId && legacy.meetName) {
      return {
        active: legacy.meetId,
        joined: [
          {
            token: legacy.token,
            meetId: legacy.meetId,
            meetName: legacy.meetName,
            role: MeetRole.Viewer,
            code: legacy.code ?? legacy.slug ?? '',
          },
        ],
      }
    }
    return { active: null, joined: [] }
  } catch {
    return { active: null, joined: [] }
  }
}

function isValidSession(j: unknown): j is GuestSessionData {
  return (
    !!j &&
    typeof j === 'object' &&
    typeof (j as GuestSessionData).token === 'string' &&
    typeof (j as GuestSessionData).meetId === 'number' &&
    typeof (j as GuestSessionData).meetName === 'string'
  )
}
