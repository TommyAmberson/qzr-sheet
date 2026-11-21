import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'
import { slotTimes } from '@qzr/shared'
import { browserTimeZone } from '@qzr/ui'

import type { MeetDetail } from '../../api'
import type { PublishedOnPage } from '../../meetPage'
import { phone } from '../../viewport'

/**
 * What a phone's list by time needs to mark the slot under way (FR-021): the time, moved on at the
 * start of each minute while the page is in view, and when each slot runs on the meet's clock. The
 * time moves only at phone width, where the list is shown.
 */
export function useScheduleClock(
  published: Ref<PublishedOnPage | null | undefined>,
  meet: Ref<MeetDetail['meet'] | null>,
) {
  const now = ref(new Date())
  let ticking: ReturnType<typeof setTimeout> | undefined
  /** The time now, and again at the start of each minute, so the mark moves on the minute */
  function tick() {
    now.value = new Date()
    ticking = setTimeout(tick, 60_000 - (now.value.getTime() % 60_000))
  }
  const stop = () => clearTimeout(ticking)
  // Stopped while the page is hidden; coming back into view catches up at once
  function onVisibility() {
    stop()
    if (document.visibilityState === 'visible') tick()
  }
  onMounted(() => {
    if (!phone) return
    tick()
    document.addEventListener('visibilitychange', onVisibility)
  })
  onUnmounted(() => {
    stop()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  const timeZone = computed(() => published.value?.document.link?.timeZone ?? browserTimeZone())

  /** When each slot runs, on the meet's clock: the linked schedule's time zone, or the reader's */
  const times = computed(() => {
    const doc = published.value?.document
    if (!doc || !meet.value) return null
    return slotTimes(doc, meet.value.dateFrom, timeZone.value)
  })

  return { now, timeZone, times }
}
