import { computed } from 'vue'
import { guestSessionRef, setGuestSession } from './guestSession'

export { initGuestSession, getGuestToken } from './guestSession'

export function useGuestSession() {
  const isActive = computed(() => guestSessionRef.value !== null)
  const meetId = computed(() => guestSessionRef.value?.meetId ?? null)
  const meetName = computed(() => guestSessionRef.value?.meetName ?? null)

  function clear(): void {
    setGuestSession(null)
  }

  return { isActive, meetId, meetName, clear }
}
