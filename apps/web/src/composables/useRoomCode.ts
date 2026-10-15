import { ref } from 'vue'
import { RoomCodeDialog, withRoomCode } from '@qzr/ui'
import { joinMeetGuest } from '../api'
import { authClient, useAuth } from './useAuth'

/** The portal's one room-code dialog, mounted by App.vue */
export const roomCodeDialog = ref<InstanceType<typeof RoomCodeDialog> | null>(null)

/**
 * Renewing a guest official's ended session on the portal's results pages: the page runs its loads
 * and saves through `renew`, which asks for the room code when the session has ended and runs the
 * action once more. Another meet's code is refused, since the page is about its meet.
 */
export function useRoomCode() {
  const { session } = useAuth()

  /**
   * Run an action for a meet, renewing a guest official's session; undefined when they cancel. With
   * `sameRoom`, for a quiz already stored for the session's room, only that room's code will do.
   */
  async function renew<T>(
    meetId: number,
    action: () => Promise<T>,
    { sameRoom = false } = {},
  ): Promise<T | undefined> {
    // A page loading just after sign-in can run before the session has; an account decides then
    const signedIn = session.value?.isPending
      ? !!(await authClient.getSession()).data?.user
      : !!session.value?.data?.user
    return withRoomCode(meetId, action, {
      join: joinMeetGuest,
      dialog: roomCodeDialog.value,
      signedIn,
      sameRoom,
    })
  }

  return { renew }
}
