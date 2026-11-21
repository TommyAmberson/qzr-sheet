<script setup lang="ts">
import { computed } from 'vue'
import {
  formatClock,
  sheetRows,
  type DayQuiz,
  type ScheduleDocument,
  type ScheduleQuiz,
  type SheetView,
  type SlotTime,
  wallClock,
} from '@qzr/shared'
import ScheduleQuizMarks from './ScheduleQuizMarks.vue'
import { markQuizzes, type ScheduleMarks } from './scheduleMarks'

/**
 * The published schedule as a list by time, for a phone (FR-021): each day's slots in order, each
 * quiz with its room and benches marked as on the sheet, its division when every division shows,
 * and the slot under way marked. Its rows are the sheet's (`sheetRows`), so a quiz shows here
 * exactly when it shows there; the sheet stays the table it is.
 */
const props = defineProps<{
  doc: ScheduleDocument
  view: SheetView
  marks: ScheduleMarks | null
  /** Each quiz's division beside it, with every division shown */
  withDivision: boolean
  /** When each slot of the whole schedule runs (`slotTimes`); null to mark no time */
  times: Map<string, SlotTime> | null
  /** The instant now, in milliseconds since the epoch; null to mark no time */
  now: number | null
  /** The meet's time zone, for the time on a "now" line */
  timeZone: string
  statusTitle?: (quiz: DayQuiz) => string
}>()

defineSlots<{ 'quiz-title'(props: { quiz: ScheduleQuiz }): unknown }>()

const roomNames = computed(() => new Map(props.doc.rooms.map((room) => [room.id, room.name])))
const divisionNames = computed(
  () => new Map(props.doc.settings.divisions.map((division) => [division.id, division.name])),
)

/**
 * Each day of the schedule with its slots that hold a quiz or an event, the quizzes in the sheet's
 * room order, and when the day runs, from its first slot's start to its last slot's end of the whole
 * schedule (`times`); slots before the first day are a day of their own, under no day's name, as on
 * the sheet
 */
const schedule = computed(() => {
  type Slot = {
    id: string
    at: number
    quizzes: { room: string; quiz: ScheduleQuiz }[]
    events: string[]
  }
  type Day = { id: string; label: string; slots: Slot[]; span: SlotTime | null }
  const out: Day[] = [{ id: '', label: '', slots: [], span: null }]
  for (const row of sheetRows(props.doc)) {
    if (row.kind === 'day')
      out.push({ id: row.row.id, label: row.row.label, slots: [], span: null })
    if (row.kind !== 'slot') continue
    const day = out[out.length - 1]!
    const t = props.times?.get(row.row.id)
    if (t) {
      day.span = day.span
        ? { start: Math.min(day.span.start, t.start), end: Math.max(day.span.end, t.end) }
        : { ...t }
    }
    const quizzes = row.cells.flatMap((cell) => (cell.kind === 'quiz' ? [cell] : []))
    const events = [
      ...new Set(row.cells.flatMap((cell) => (cell.kind === 'event' ? [cell.event.label] : []))),
    ]
    if (quizzes.length === 0 && events.length === 0) continue
    day.slots.push({ id: row.row.id, at: row.row.at, quizzes, events })
  }
  return out
})

/** The days with a slot listed */
const days = computed(() => schedule.value.filter((day) => day.slots.length > 0))

/**
 * Where the meet's clock is on the list: the slot listed that is under way, or, while a schedule
 * day runs and none is (the reader's division has no quiz then), a "now" line before the next slot
 * listed, at the end once none is left. Before a day's first slot listed, the line sits under the
 * day's name once that day has begun, and above it before then
 */
const clock = computed(() => {
  const { times, now } = props
  type Line = { before: string | null; inDay: boolean; label: string }
  const quiet = { underWay: null as string | null, line: null as Line | null }
  if (!times || now === null) return quiet
  const holds = (t: SlotTime | null | undefined) => !!t && t.start <= now && now < t.end
  const listed = days.value.flatMap((day) => day.slots.map((slot) => ({ day, slot })))
  const underWay = listed.find(({ slot }) => holds(times.get(slot.id)))
  if (underWay) return { ...quiet, underWay: underWay.slot.id }
  if (!schedule.value.some((day) => holds(day.span))) return quiet
  const next = listed.find(({ slot }) => (times.get(slot.id)?.start ?? -Infinity) > now)
  const label = formatClock(wallClock(new Date(now), props.timeZone).minutes)
  const inDay = !!next?.day.span && next.day.span.start <= now
  return { ...quiet, line: { before: next?.slot.id ?? null, inDay, label } }
})

/** Each quiz's benches as marked, worked out once per marks */
const marked = computed(() => markQuizzes(props.doc, props.marks))
</script>

<template>
  <div class="schedule-list">
    <section v-for="day in days" :key="day.id" class="list-day">
      <p
        v-if="clock.line && !clock.line.inDay && clock.line.before === day.slots[0]!.id"
        class="now-line"
      >
        Now · {{ clock.line.label }}
      </p>
      <h3 v-if="day.label" class="day-label">{{ day.label }}</h3>
      <template v-for="(slot, i) in day.slots" :key="slot.id">
        <p v-if="clock.line?.before === slot.id && (i > 0 || clock.line.inDay)" class="now-line">
          Now · {{ clock.line.label }}
        </p>
        <div class="list-slot" :class="{ 'under-way': slot.id === clock.underWay }">
          <p class="slot-time">
            {{ formatClock(slot.at) }}
            <span v-if="slot.events.length > 0" class="events">{{ slot.events.join(' · ') }}</span>
            <span v-if="slot.id === clock.underWay" class="now">Under way</span>
          </p>
          <article v-for="{ room, quiz } in slot.quizzes" :key="quiz.id" class="list-quiz qz-seats">
            <header class="quiz-head">
              <slot name="quiz-title" :quiz="quiz">
                <span class="quiz-title">{{ quiz.label }}</span>
              </slot>
              <span class="where">
                {{ roomNames.get(room) }}
                <template v-if="withDivision">
                  · {{ divisionNames.get(quiz.division) ?? quiz.division }}</template
                >
              </span>
            </header>
            <ScheduleQuizMarks
              :doc="doc"
              :quiz="quiz"
              :view="view"
              :marked="marked.get(quiz.id)"
              :day="marks?.quizzes.get(quiz.id)"
              :status-title="statusTitle"
              plain
            />
          </article>
        </div>
      </template>
    </section>
    <p v-if="clock.line && clock.line.before === null" class="now-line">
      Now · {{ clock.line.label }}
    </p>
  </div>
</template>

<style scoped>
.list-day + .list-day {
  margin-top: 1.25rem;
}

.day-label {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-bottom: 0.4rem;
}

.list-slot {
  border-left: 3px solid var(--color-border);
  padding: 0.25rem 0 0.5rem 0.6rem;
  margin-bottom: 0.5rem;
}

.list-slot.under-way {
  border-left-color: var(--color-accent, #60a5fa);
}

.slot-time {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 0.3rem;
}

.now-line {
  border-top: 2px solid var(--color-accent, #60a5fa);
  color: var(--color-accent, #60a5fa);
  font-size: 0.75rem;
  font-weight: 600;
  padding-top: 0.15rem;
  margin: 0.25rem 0 0.5rem;
}

.events {
  margin-left: 0.4rem;
  font-weight: 400;
  font-style: italic;
}

.now {
  margin-left: 0.4rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--color-accent, #60a5fa);
  color: var(--color-bg, #fff);
  font-size: 0.7rem;
}

.list-quiz {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.4rem 0.5rem;
  margin-bottom: 0.4rem;
  background: var(--color-bg);
}

.quiz-head {
  display: flex;
  /* A long room or division wraps under the title rather than push the page sideways (SC-005) */
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  font-size: 0.85rem;
}

.quiz-title,
:slotted(.quiz-title) {
  font-weight: 600;
}

.where {
  color: var(--color-text-muted);
  text-align: right;
}
</style>
