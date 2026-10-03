import { computed } from 'vue'
import {
  guestStateRef,
  setGuestState,
  setActiveSession,
  getActiveSession,
  initGuestSession as initWith,
  joinByCode as joinWith,
  type GuestSessionData,
} from '@qzr/ui'
import { joinMeetGuest } from '../api'

export { guestTokenFor, joinedSession } from '@qzr/ui'
export type { GuestSessionData } from '@qzr/ui'

/** Join from the page's `?meet=` link, once; see `initGuestSession` in `@qzr/ui` */
export function initGuestSession() {
  return initWith(joinMeetGuest)
}

/** Join a meet with a typed-in viewer or official code */
export function joinByCode(code: string) {
  return joinWith(code, joinMeetGuest)
}

export function useGuestSession() {
  const isActive = computed(() => guestStateRef.value.active !== null)
  const meetId = computed(() => getActiveSession()?.meetId ?? null)
  const meetName = computed(() => getActiveSession()?.meetName ?? null)
  /** Every meet the user has joined as a guest, oldest first. */
  const joinedMeets = computed<GuestSessionData[]>(() => guestStateRef.value.joined)

  function setActive(meetIdToActivate: number | null): void {
    setActiveSession(meetIdToActivate)
  }

  function clear(): void {
    setGuestState(null)
  }

  return { isActive, meetId, meetName, joinedMeets, setActive, clear }
}
