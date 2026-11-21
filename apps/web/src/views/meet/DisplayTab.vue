<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { ScheduleList, ScheduleSheet, type ScheduleMarks } from '@qzr/ui'

import { currentSlot } from './currentSlot'
import { useScheduleClock } from './useScheduleClock'
import { useMeetPage } from '../../meetPage'
import { phone } from '../../viewport'

/**
 * The meet's schedule for a screen in the room: the sheet alone, across the whole width, with the
 * meet day's results and settled benches on it, kept current by the meet page's 30 seconds. On a
 * phone, the Schedule tab's list by time with the slot under way marked. It scrolls in a box the
 * height of the screen, the rooms and the day's name held at its top, and opens on the quiz under
 * way. Nothing on it opens anything, since nobody taps a projector.
 */
const { meet, division, inScheduleDivision, published, day, dayError } = useMeetPage()

/** The schedule shown: the picked division's quizzes, or every division's */
const shown = computed(() => {
  const all = published.value?.document
  return all && { ...all, quizzes: all.quizzes.filter((q) => inScheduleDivision(q.division)) }
})

const marks = computed<ScheduleMarks | null>(() =>
  day.value
    ? { quizzes: new Map(day.value.quizzes.map((q) => [q.id, q])), benches: day.value.benches }
    : null,
)

const { now, timeZone, times } = useScheduleClock(published, meet)

/** The box the schedule scrolls in */
const box = ref<HTMLElement | null>(null)

// ---- The rooms, and the day's name under them, held at the top ----

/** The rooms' header, measured so the day's name sticks just under it, whatever its height */
let measuring: ResizeObserver | undefined
function measureRooms() {
  const el = box.value
  const rooms = el?.querySelector('thead')
  if (!el) return
  el.style.setProperty('--rooms-height', `${rooms?.offsetHeight ?? 0}px`)
}
watch(
  [box, shown],
  () => {
    measuring?.disconnect()
    measureRooms()
    const rooms = box.value?.querySelector('thead')
    if (!rooms || typeof ResizeObserver === 'undefined') return
    measuring = new ResizeObserver(measureRooms)
    measuring.observe(rooms)
  },
  { flush: 'post' },
)
onUnmounted(() => measuring?.disconnect())

// ---- Opening on the quiz under way ----

/**
 * Scroll the box so a slot sits just under what is held at the top: the rooms, and a day's name,
 * whose row starts the slot's day, so the slot's own day is the one shown
 */
function scrollToSlot(el: HTMLElement, id: string) {
  const row = [...el.querySelectorAll<HTMLElement>('[data-slot]')].find(
    (r) => r.dataset.slot === id,
  )
  if (!row) return
  const rooms = el.querySelector<HTMLElement>('thead')?.offsetHeight ?? 0
  const dayName = el.querySelector<HTMLElement>('.day th, .day-label')?.offsetHeight ?? 0
  const offset = row.getBoundingClientRect().top - el.getBoundingClientRect().top
  el.scrollTop += offset - rooms - dayName
}

/**
 * Opened once, on the slot that most recently started, which stays the one until the next starts:
 * opened again after the next has started, the page is on that one. It waits for the meet day,
 * since the results it adds change the rows' heights, and gives up on it if it can't be read.
 */
let opened = false
watch(
  [box, shown, times, day, dayError],
  async () => {
    const el = box.value
    if (opened || !el || !shown.value || !times.value) return
    if (day.value === null && !dayError.value) return
    opened = true
    await nextTick()
    const id = currentSlot(shown.value, times.value, Date.now())
    if (id) scrollToSlot(el, id)
  },
  { flush: 'post' },
)
</script>

<template>
  <div class="display">
    <p v-if="published === undefined" class="state-msg">Loading…</p>
    <p v-else-if="published === null" class="state-msg">The schedule hasn't been published yet.</p>
    <div v-else-if="shown" ref="box" class="display-scroll">
      <ScheduleList
        v-if="phone"
        :doc="shown"
        :view="published.view"
        :marks="marks"
        :times="times"
        :now="now.getTime()"
        :time-zone="timeZone"
        :with-division="division === null && published.document.settings.divisions.length > 1"
      >
        <template #quiz-title="{ quiz }">
          <span class="quiz-title">{{ quiz.label }}</span>
        </template>
      </ScheduleList>
      <ScheduleSheet v-else class="published" :doc="shown" :view="published.view" :marks="marks">
        <template #quiz-title="{ quiz }">
          <span class="quiz-title">{{ quiz.label }}</span>
        </template>
      </ScheduleSheet>
    </div>
  </div>
</template>

<style scoped>
/* The rest of the screen under the button back, the schedule scrolling inside it */
.display {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.display-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

/* The sheet across the whole screen, its rooms sharing the width, a little larger than on the
   page to be read across a room. Its rooms already stick to the top of the box */
.display-scroll :deep(.sheet) {
  width: 100%;
  font-size: 1rem;
}

/* The day's name held under the rooms, each day's covering the last as it reaches the top, and the
   times scrolling under it as they do under the rooms */
.display-scroll :deep(.day th) {
  position: sticky;
  top: var(--rooms-height, 0);
  z-index: 2;
  background: var(--color-bg, #fff);
}

.display-scroll :deep(thead th) {
  z-index: 3;
}

/* On a phone, the day's name held at the top of the list */
.display-scroll :deep(.day-label) {
  position: sticky;
  top: 0;
  z-index: 1;
  margin-bottom: 0;
  padding: 0.3rem 0 0.4rem;
  background: var(--color-bg-warm);
}
</style>
