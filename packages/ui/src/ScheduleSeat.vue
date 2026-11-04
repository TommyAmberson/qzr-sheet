<script setup lang="ts">
import { computed } from 'vue'
import { seatText, type ScheduleDocument, type ScheduleQuiz, type SheetView } from '@qzr/shared'
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
}>()

const seat = computed(() => props.quiz.seats[props.index]!)
const source = computed(() => seatText(props.doc, props.quiz, seat.value, 'letters'))
const absent = computed(() => {
  const s = seat.value
  return (
    s.kind === 'letter' &&
    (props.doc.draw[props.quiz.division]?.teams.some((t) => t.letter === s.letter && t.absent) ??
      false)
  )
})
const team = computed(() =>
  absent.value
    ? 'Absent'
    : props.view === 'teams' && seat.value.kind === 'letter'
      ? seatText(props.doc, props.quiz, seat.value, 'teams')
      : '',
)
</script>

<template>
  <button type="button" class="qz-seat" :data-seat="`${quiz.id}:${index}`" :title="source">
    <span class="qz-seat-src" :class="{ choose: seat.kind === 'empty' }">{{ source }}</span>
    <span class="qz-bench" :class="`qz-bench-${index}`" />
    <span class="qz-seat-line" :class="{ absent }">{{ team }}</span>
  </button>
</template>
