import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { MeetDay } from '@qzr/shared'
import { getMeetDay } from '../api'

/** How often an open, visible meet page reads the meet again (FR-022) */
export const MEET_DAY_SECONDS = 30

/**
 * Why the meet day is read, which decides what its answer asks of the tabs (research R7, rule 2):
 * `poll`, the 30 seconds or coming back into view, moves the beat when the meet changed; `refresh`,
 * the reader's Refresh, always moves it; `catchUp`, after a tab switch or the reader's own change in
 * a tab, never does, since the tab shown reads what it shows itself.
 */
export type DayRead = 'poll' | 'refresh' | 'catchUp'

/**
 * The meet day while its page is open (FR-022): read on opening and on `refresh`, when the browser
 * tab comes back into view, and every 30 seconds while it is visible, never while hidden. One read
 * is on its way at a time; `beat` tells the tabs to read their own data again, so none keeps a
 * timer of its own and a quiet meet costs one read every 30 seconds.
 */
export function useMeetDay(
  meetId: Ref<number | null>,
  read: (meetId: number, signal: AbortSignal) => Promise<MeetDay> = getMeetDay,
) {
  const day = shallowRef<MeetDay | null>(null)
  const error = ref('')
  const beat = ref(0)
  /** The day as last read, to tell whether a read changed anything */
  let seen = ''
  /** A Refresh not yet answered: whichever read answers next moves the beat for it */
  let refreshOwed = false
  /** The read on its way, cancelled when another replaces it */
  let current: AbortController | null = null

  function cancel() {
    current?.abort()
    current = null
  }

  async function refresh(why: DayRead = 'refresh') {
    const id = meetId.value
    if (id === null) return
    // The 30 seconds wait for a read already on its way; anything else replaces it
    if (why === 'poll' && current) return
    cancel()
    const mine = new AbortController()
    current = mine
    if (why === 'refresh') refreshOwed = true
    try {
      const answer = await read(id, mine.signal)
      if (mine.signal.aborted) return
      error.value = ''
      const text = JSON.stringify(answer)
      const changed = text !== seen
      const moves = refreshOwed || (why === 'poll' && changed)
      seen = text
      refreshOwed = false
      if (changed) day.value = answer
      if (moves) beat.value++
    } catch (e) {
      if (mine.signal.aborted) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (current === mine) current = null
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined
  const visible = () => document.visibilityState === 'visible'

  function start() {
    stop()
    timer = setInterval(() => {
      if (visible()) void refresh('poll')
    }, MEET_DAY_SECONDS * 1000)
  }

  function stop() {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  // Coming back into view reads at once and restarts the 30 seconds from there
  function onVisibility() {
    if (!visible()) return stop()
    void refresh('poll')
    start()
  }

  // Another meet starts afresh: none of the last one's day shows against it
  watch(meetId, (id, was) => {
    if (id === null || id === was) return
    cancel()
    day.value = null
    error.value = ''
    seen = ''
    refreshOwed = false
    void refresh('catchUp')
  })

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility)
    void refresh('catchUp')
    if (visible()) start()
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    stop()
    cancel()
  })

  return { day, error, beat, refresh }
}
