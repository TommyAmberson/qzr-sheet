<script setup lang="ts">
import { computed } from 'vue'
import {
  drawnTeam,
  ordinal,
  seatText,
  type DayTeam,
  type ScheduleDocument,
  type ScheduleQuiz,
  type SettledBench,
  type SheetView,
} from '@qzr/shared'
import { settledText } from './scheduleMarks'
import './seat.css'

/**
 * One of a quiz's seats, as a button: where it comes from, its bench colour, and the line its team
 * goes on, which holds the drawn team's name in Teams view and is otherwise blank. A team marked
 * absent shows as Absent in either view, its quizzes running with two teams (FR-042b).
 */
const props = defineProps<{
  doc: ScheduleDocument
  quiz: ScheduleQuiz
  index: number
  view: SheetView
  /** The team settled onto the bench from results or a confirmed order (FR-011) */
  settled?: SettledBench
  /** The result of the team on the bench: its place, and its score where shown (FR-010) */
  result?: DayTeam
}>()

const seat = computed(() => props.quiz.seats[props.index]!)
const source = computed(() => seatText(props.doc, props.quiz, seat.value, 'letters'))
const absent = computed(() => drawnTeam(props.doc, props.quiz, seat.value)?.absent ?? false)
const team = computed(() =>
  absent.value
    ? 'Absent'
    : props.settled
      ? settledText(props.settled)
      : props.view === 'teams' && seat.value.kind === 'letter'
        ? seatText(props.doc, props.quiz, seat.value, 'teams')
        : '',
)
const outcome = computed(() => {
  const r = props.result
  if (!r || r.place === undefined) return ''
  const place = r.tiedWith && r.tiedWith > 1 ? `=${ordinal(r.place)}` : ordinal(r.place)
  return r.score === undefined ? place : `${place} · ${r.score}`
})
</script>

<template>
  <button type="button" class="qz-seat" :data-seat="`${quiz.id}:${index}`" :title="source">
    <span class="qz-seat-src" :class="{ choose: seat.kind === 'empty' }">{{ source }}</span>
    <span class="qz-bench" :class="`qz-bench-${index}`" />
    <span class="qz-seat-line" :class="{ absent, tied: settled && 'tied' in settled }">{{
      team
    }}</span>
    <span v-if="outcome" class="qz-seat-result" :class="`place-${result?.place}`">{{
      outcome
    }}</span>
  </button>
</template>
