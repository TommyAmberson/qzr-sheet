import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { MeetDay } from '@qzr/shared'
import { getMeetDay } from '../api'

/** How often an open, visible meet page reads the meet again (FR-022) */
export const MEET_DAY_SECONDS = 30

/**
 * The meet day while its page is open (FR-022): read on opening, on `refresh` (a tab switch or the
 * Refresh button), when the browser tab comes back into view, and every 30 seconds while it is
 * visible, never while hidden. `beat` counts the reads, so each tab re-reads its own data on the
 * same beat and none keeps a timer of its own.
 */
export function useMeetDay(
  meetId: Ref<number | null>,
  read: (meetId: number) => Promise<MeetDay> = getMeetDay,
) {
  const day = shallowRef<MeetDay | null>(null)
  const error = ref('')
  const loading = ref(false)
  const beat = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined
  // A read answered after a newer one began is dropped, so the page never steps back
  let asked = 0

  async function refresh() {
    const id = meetId.value
    if (id === null) return
    const ask = ++asked
    loading.value = true
    try {
      const answer = await read(id)
      if (ask !== asked) return
      day.value = answer
      error.value = ''
    } catch (e) {
      if (ask !== asked) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (ask === asked) {
        loading.value = false
        beat.value++
      }
    }
  }

  const visible = () => document.visibilityState === 'visible'

  function start() {
    stop()
    timer = setInterval(() => {
      if (visible()) void refresh()
    }, MEET_DAY_SECONDS * 1000)
  }

  function stop() {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  // Coming back into view reads at once and restarts the 30 seconds from there
  function onVisibility() {
    if (!visible()) return stop()
    void refresh()
    start()
  }

  watch(meetId, (id, was) => {
    if (id !== null && id !== was) void refresh()
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

  return { day, error, loading, beat, refresh }
}
