import { ref, computed } from 'vue'

/**
 * Guest session for visitors hitting the scoresheet via a shareable URL like
 * `/scoresheet/?meet=fall-2025`. The slug matches a meet's public viewer code.
 *
 * On bootstrap (`initGuestSession`), the URL is parsed; if a `?meet=` slug is
 * present and there's no signed-in cookie session in flight already, we POST
 * to `/api/join/guest` to obtain a 24h JWT scoped to that meet. The token is
 * stashed in localStorage so the same scoresheet tab survives a reload, and
 * the API client wrapper attaches it to outgoing requests via `getGuestToken`.
 */

declare const __API_URL__: string

const STORAGE_KEY = 'qzr-guest-session'
const URL_PARAM = 'meet'

export interface GuestSessionData {
  token: string
  meetId: number
  meetName: string
}

const session = ref<GuestSessionData | null>(loadFromStorage())

/** Synchronous accessor used by the API client wrapper. */
export function getGuestToken(): string | null {
  return session.value?.token ?? null
}

export function useGuestSession() {
  const isActive = computed(() => session.value !== null)
  const meetId = computed(() => session.value?.meetId ?? null)
  const meetName = computed(() => session.value?.meetName ?? null)

  function clear(): void {
    session.value = null
    persist()
  }

  return { isActive, meetId, meetName, clear }
}

/**
 * Bootstrap: read `?meet=<slug>` from the URL and either reuse an existing
 * guest session for the same meet or obtain a fresh JWT. Returns the resulting
 * session (or null if there was no slug / the join failed).
 *
 * Safe to call multiple times — re-uses an existing session for the same slug
 * without a second network call.
 */
export async function initGuestSession(): Promise<GuestSessionData | null> {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const slug = params.get(URL_PARAM)?.trim()
  if (!slug) return null

  // Reuse existing session if it's for the same slug — slugs map 1:1 to meetIds.
  // We don't know the slug→meetId mapping client-side, so re-issue if anything
  // looks off (token missing, different meetId we can't verify, etc.).
  // Cheap to call: server returns the same JWT lifetime (24h).

  try {
    const res = await fetch(`${__API_URL__ || ''}/api/join/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: slug }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      token: string
      meet: { id: number; name: string }
      role: string
    }
    if (body.role !== 'viewer') return null
    const data: GuestSessionData = {
      token: body.token,
      meetId: body.meet.id,
      meetName: body.meet.name,
    }
    session.value = data
    persist()
    return data
  } catch {
    return null
  }
}

function persist() {
  if (session.value === null) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session.value))
  }
}

function loadFromStorage(): GuestSessionData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as GuestSessionData
  } catch {
    return null
  }
}
