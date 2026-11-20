<script setup lang="ts">
import type { DayQuiz, ScheduleDocument, ScheduleQuiz, SheetView } from '@qzr/shared'
import ScheduleSeat from './ScheduleSeat.vue'
import { resultText, STATUS_TEXT, type MarkedQuiz } from './scheduleMarks'

/**
 * A scheduled quiz's benches as marked, with the teams of its result its benches don't name and its
 * status (specs/010-meet-day FR-009 to FR-011): the body the sheet and the phone list both draw
 */
defineProps<{
  doc: ScheduleDocument
  quiz: ScheduleQuiz
  view: SheetView
  /** Its benches as marked; none where the page shows no results, as the builder */
  marked?: MarkedQuiz
  /** Its status and result from the meet day */
  day?: DayQuiz
  statusTitle?: (quiz: DayQuiz) => string
  /** Its benches for reading alone, with nothing to tap */
  plain?: boolean
}>()

const emit = defineEmits<{ seat: [index: number, event: MouseEvent] }>()
</script>

<template>
  <ScheduleSeat
    v-for="(_, i) in quiz.seats"
    :key="i"
    class="seat"
    :doc="doc"
    :quiz="quiz"
    :index="i"
    :view="view"
    :settled="marked?.benches[i]?.settled"
    :result="marked?.benches[i]?.result"
    :plain="plain"
    v-on="plain ? {} : { click: (e: MouseEvent) => emit('seat', i, e) }"
  />
  <span v-for="t in marked?.unplaced ?? []" :key="t.name" class="unplaced"
    >{{ t.name }}{{ resultText(t) ? ` · ${resultText(t)}` : '' }}</span
  >
  <span
    v-if="day && STATUS_TEXT[day.status]"
    class="status"
    :class="`status-${day.status}`"
    :title="statusTitle?.(day) || undefined"
    >{{ STATUS_TEXT[day.status] }}</span
  >
</template>

<style scoped>
/* A result team no bench names, and a quiz's status: small, under its benches */
.unplaced,
.status {
  /* Under the benches, wherever the quiz is drawn, and no wider than its words */
  display: block;
  width: fit-content;
  margin-inline: auto;
  font-size: 0.7rem;
  line-height: 1.2;
  text-align: center;
}

.unplaced {
  color: var(--color-text-muted, #6b6560);
}

.status {
  padding: 0 0.35rem;
  border-radius: 999px;
  color: var(--color-text-muted, #6b6560);
  font-style: italic;
}

.status-attention {
  background: var(--color-warn-bg, #fdf2e2);
  color: var(--color-warn, #a60);
  font-style: normal;
  font-weight: 600;
}

.status-underReview {
  color: var(--color-warn, #a60);
}
</style>
