<script setup lang="ts">
import { computed } from 'vue'
import {
  drawnTeam,
  seatText,
  type DayTeam,
  type ScheduleDocument,
  type ScheduleQuiz,
  type SettledBench,
  type SheetView,
} from '@qzr/shared'
import { vFitName, type FitName } from './fitName'
import { resultText, settledShortText, settledText } from './scheduleMarks'
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
  /** Drawn for reading alone, as on a reader's page: not a button, since a tap does nothing */
  plain?: boolean
}>()

const seat = computed(() => props.quiz.seats[props.index]!)
const source = computed(() => seatText(props.doc, props.quiz, seat.value, 'letters'))
const absent = computed(() => drawnTeam(props.doc, props.quiz, seat.value)?.absent ?? false)
/**
 * The line's team, by its short name ("FC 1") wherever the line is, so every line of the schedule
 * reads alike and leaves room for the result beside it; its full name is kept for the tooltip
 */
const names = computed((): FitName => {
  const one = (name: string) => ({ full: name, short: name })
  if (absent.value) return one('Absent')
  if (props.settled) {
    return {
      full: settledText(props.settled),
      short: settledShortText(props.doc, props.quiz, props.settled),
    }
  }
  if (props.view === 'teams' && seat.value.kind === 'letter') {
    return one(seatText(props.doc, props.quiz, seat.value, 'teams'))
  }
  return one('')
})
/** The short name alone on the line, which keeps its number in sight if it is cut short */
const team = computed((): FitName => ({ full: names.value.short, short: names.value.short }))
const outcome = computed(() => (props.result ? resultText(props.result) : ''))
/** Where the bench comes from, and its team's full name, which the line shortens */
const tooltip = computed(() => {
  // An absent bench names the team that is absent; Tied is no team's name
  if (absent.value) {
    const name = drawnTeam(props.doc, props.quiz, seat.value)?.name
    return name ? `${source.value} · ${name} (absent)` : source.value
  }
  const named = !(props.settled && 'tied' in props.settled)
  return named && names.value.full && names.value.full !== source.value
    ? `${source.value} · ${names.value.full}`
    : source.value
})
</script>

<template>
  <component
    :is="plain ? 'div' : 'button'"
    :type="plain ? undefined : 'button'"
    class="qz-seat"
    :data-seat="`${quiz.id}:${index}`"
    :title="tooltip"
  >
    <span class="qz-seat-src" :class="{ choose: seat.kind === 'empty' }">{{ source }}</span>
    <span class="qz-bench" :class="`qz-bench-${index}`" />
    <span
      v-fit-name="team"
      class="qz-seat-line"
      :class="{ absent, tied: settled && 'tied' in settled }"
    />
    <span v-if="outcome" class="qz-seat-result" :class="`place-${result?.place}`">{{
      outcome
    }}</span>
  </component>
</template>
