import { computed } from 'vue'
import {
  guestStateRef,
  setGuestState,
  setActiveSession,
  getActiveSession,
  type GuestSessionData,
} from './guestSession'

export { initGuestSession, getGuestToken, joinByCode } from './guestSession'
export type { GuestSessionData } from './guestSession'

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
