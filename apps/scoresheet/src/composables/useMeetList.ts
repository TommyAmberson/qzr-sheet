import { ref } from 'vue'

import { ApiError } from '@qzr/shared'

import { getMyMeets, joinMeet, type MeetSummary } from '../api'
import { initGuestSession, joinByCode, useGuestSession } from './useGuestSession'

/**
 * Shared logic for the "pick a meet" step used by both
 * MeetPickerDialog and SchedulePickerDialog. Tracks the merged list of
 * joined-guest meets and signed-in memberships, drives the "Have a
 * code?" join flow, and exposes a flag for whether the last fetch saw
 * a signed-in cookie session.
 */
export function useMeetList() {
  const guest = useGuestSession()

  const meets = ref<MeetSummary[]>([])
  const loading = ref(false)
  const error = ref('')
  const joinCode = ref('')
  const joinError = ref('')
  const joining = ref(false)
  const signedIn = ref(false)

  async function fetchMeets() {
    loading.value = true
    error.value = ''
    const seen = new Set<number>()
    const list: MeetSummary[] = []
    for (const j of guest.joinedMeets.value) {
      list.push({ meetId: j.meetId, meetName: j.meetName, role: j.role })
      seen.add(j.meetId)
    }
    try {
      const res = await getMyMeets()
      signedIn.value = true
      for (const m of res.memberships) {
        if (seen.has(m.meetId)) continue
        seen.add(m.meetId)
        list.push(m)
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        signedIn.value = false
        if (list.length === 0) error.value = 'Not signed in.'
      } else {
        error.value = (e as Error).message
      }
    } finally {
      meets.value = list
      loading.value = false
    }
  }

  /** Populate the meet list. Awaits the shared guest session init so
   *  URL-shared guest meets are merged in before the first render. */
  async function init() {
    loading.value = true
    await initGuestSession()
    await fetchMeets()
  }

  async function handleJoinCode() {
    const code = joinCode.value.trim()
    if (!code) return
    joining.value = true
    joinError.value = ''
    try {
      if (signedIn.value) {
        await joinMeet(code)
      } else {
        const data = await joinByCode(code)
        if (!data) throw new Error('Invalid code.')
      }
      joinCode.value = ''
      await fetchMeets()
    } catch (e) {
      joinError.value = (e as Error).message
    } finally {
      joining.value = false
    }
  }

  /** Switches the active guest session (no-op for signed-in memberships)
   *  so subsequent API requests target the picked meet's JWT. */
  function setActiveGuest(meetId: number) {
    guest.setActive(meetId)
  }

  return {
    meets,
    loading,
    error,
    joinCode,
    joinError,
    joining,
    signedIn,
    init,
    fetchMeets,
    handleJoinCode,
    setActiveGuest,
  }
}
