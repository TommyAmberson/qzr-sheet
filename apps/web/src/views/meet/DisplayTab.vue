<script setup lang="ts">
import { computed } from 'vue'
import { ScheduleList, ScheduleSheet, type ScheduleMarks } from '@qzr/ui'

import { useScheduleClock } from './useScheduleClock'
import { useMeetPage } from '../../meetPage'
import { phone } from '../../viewport'

/**
 * The meet's schedule for a screen in the room: the sheet alone, across the whole width, with the
 * meet day's results and settled benches on it, kept current by the meet page's 30 seconds. On a
 * phone, the Schedule tab's list by time with the slot under way marked. Nothing on it opens
 * anything, since nobody taps a projector.
 */
const { meet, division, inScheduleDivision, published, day } = useMeetPage()

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
</script>

<template>
  <div class="display">
    <p v-if="published === undefined" class="state-msg">Loading…</p>
    <p v-else-if="published === null" class="state-msg">The schedule hasn't been published yet.</p>
    <ScheduleList
      v-else-if="shown && phone"
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
    <!-- Scrolls in its own box where the rooms are more than the screen is wide -->
    <div v-else-if="shown" class="sheet-scroll">
      <ScheduleSheet class="published" :doc="shown" :view="published.view" :marks="marks">
        <template #quiz-title="{ quiz }">
          <span class="quiz-title">{{ quiz.label }}</span>
        </template>
      </ScheduleSheet>
    </div>
  </div>
</template>

<style scoped>
.sheet-scroll {
  overflow-x: auto;
}

/* The sheet across the whole screen, its rooms sharing the width, a little larger than on the
   page to be read across a room */
.sheet-scroll :deep(.sheet) {
  width: 100%;
  font-size: 1rem;
}
</style>
