import { ref } from 'vue'
import { MeetRole } from '@qzr/shared'
import { joinMeetGuest } from '../api'

/**
 * Guest session state for visitors hitting the scoresheet via a shareable
 * URL like `/scoresheet/?meet=fall-2025`. The slug matches a meet's public
 * `viewerCode`. The state lives in this non-`use*` module so the API client
 * (`api.ts`) can read the token synchronously without going through Vue's
 * composable contract.
 */

const STORAGE_KEY = 'qzr-guest-session'
const URL_PARAM = 'meet'
/** Skew applied to the JWT exp claim — refresh if less than this remaining. */
const REFRESH_SKEW_MS = 5 * 60 * 1000

export interface GuestSessionData {
  token: string
  meetId: number
  meetName: string
  /** Viewer code used to obtain this token; lets us refresh against the same meet. */
  slug: string
}

export const guestSessionRef = ref<GuestSessionData | null>(loadFromStorage())

/** Synchronous accessor used by the API client wrapper. */
export function getGuestToken(): string | null {
  return guestSessionRef.value?.token ?? null
}

export function setGuestSession(data: GuestSessionData | null): void {
  guestSessionRef.value = data
  persist()
}

/**
 * Bootstrap: read `?meet=<slug>` from the URL and either reuse a fresh stored
 * token or obtain a new one. Safe to call multiple times.
 */
export async function initGuestSession(): Promise<GuestSessionData | null> {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const slug = params.get(URL_PARAM)?.trim()
  if (!slug) return null

  const existing = guestSessionRef.value
  if (existing && existing.slug === slug && tokenIsFresh(existing.token)) {
    return existing
  }

  const res = await joinMeetGuest(slug)
  if (!res || res.role !== MeetRole.Viewer) return null
  const data: GuestSessionData = {
    token: res.token,
    meetId: res.meet.id,
    meetName: res.meet.name,
    slug,
  }
  setGuestSession(data)
  return data
}

/**
 * Return true if the JWT is more than REFRESH_SKEW_MS away from expiring.
 * We never trust the exp claim for security (the server re-verifies), only
 * to decide when to skip a refresh round-trip.
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
  if (guestSessionRef.value === null) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(guestSessionRef.value))
  }
}

function loadFromStorage(): GuestSessionData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<GuestSessionData>
    // `slug` was added later — older sessions without it are treated as stale
    // so the next initGuestSession() refreshes them with a slug-keyed entry.
    if (!data.token || !data.meetId || !data.meetName || !data.slug) return null
    return data as GuestSessionData
  } catch {
    return null
  }
}
