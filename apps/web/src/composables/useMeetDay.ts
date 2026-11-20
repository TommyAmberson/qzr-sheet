import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { MeetDay } from '@qzr/shared'
import { getMeetDay } from '../api'

/** How often an open, visible meet page reads the meet again (FR-022) */
export const MEET_DAY_SECONDS = 30

/**
 * The meet day while its page is open (FR-022): read on opening, on `refresh` (a tab switch or the
 * Refresh button), when the browser tab comes back into view, and every 30 seconds while it is
 * visible, never while hidden. `beat` moves on each asked-for read and on any read that finds the
 * meet changed, so each tab re-reads its own data on the same beat, none keeps a timer of its own,
 * and a quiet meet costs one read every 30 seconds.
 */
export function useMeetDay(
  meetId: Ref<number | null>,
  read: (meetId: number) => Promise<MeetDay> = getMeetDay,
) {
  const day = shallowRef<MeetDay | null>(null)
  const error = ref('')
  const beat = ref(0)
  /** The day as last read, to tell whether a read changed anything */
  let seen = ''
  /** A reader asked for a read that hasn't yet moved the beat, so the next answer must */
  let owed = false
  let timer: ReturnType<typeof setInterval> | undefined
  // A read answered after a newer one began is dropped, so the page never steps back
  let asked = 0

  /** Read the meet day; `wanted` for a reader's own refresh, which always moves the beat */
  async function refresh(wanted = true) {
    const id = meetId.value
    if (id === null) return
    owed ||= wanted
    const ask = ++asked
    try {
      const answer = await read(id)
      if (ask !== asked) return
      error.value = ''
      const text = JSON.stringify(answer)
      if (text === seen && !owed) return
      // The tabs read their own data on opening, so the first answer leaves the beat be
      const first = seen === ''
      seen = text
      owed = false
      day.value = answer
      if (!first) beat.value++
    } catch (e) {
      if (ask !== asked) return
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  const visible = () => document.visibilityState === 'visible'

  function start() {
    stop()
    timer = setInterval(() => {
      if (visible()) void refresh(false)
    }, MEET_DAY_SECONDS * 1000)
  }

  function stop() {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  // Coming back into view reads at once and restarts the 30 seconds from there
  function onVisibility() {
    if (!visible()) return stop()
    void refresh(false)
    start()
  }

  // Another meet starts afresh: none of the last one's day shows against it
  watch(meetId, (id, was) => {
    if (id === null || id === was) return
    day.value = null
    seen = ''
    owed = false
    void refresh()
  })

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility)
    void refresh()
    if (visible()) start()
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    stop()
  })

  return { day, error, beat, refresh }
}
