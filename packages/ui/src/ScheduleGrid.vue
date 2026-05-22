<script setup lang="ts">
import { computed } from 'vue'

import {
  type DayGroup,
  type Grid,
  type MeetTeamRow,
  type PrelimAssignmentRow,
  type ScheduleRoom,
  type ScheduleSlot,
  type ScheduledQuiz,
  type ScheduledSeat,
  buildGrid,
  formatSlotTime,
  groupRowsByDay,
  hasAnyQuiz,
  seatRef,
  sortedSeats,
} from './scheduleGrid'

const props = defineProps<{
  rooms: ScheduleRoom[]
  slots: ScheduleSlot[]
  quizzes: ScheduledQuiz[]
  prelimAssignments?: PrelimAssignmentRow[]
  meetTeams?: MeetTeamRow[]
  divisionFilter?: string | null
  /** Empty-state message when there are no quizzes / no rooms. */
  emptyMessage?: string
}>()

defineSlots<{
  /** Cell shown in the time column for each row. Defaults to formatted time. */
  'time-cell'(props: { gridSlot: ScheduleSlot }): unknown
  /** Quiz label inside an occupied quiz cell. Defaults to a plain span. */
  'quiz-label'(props: { quiz: ScheduledQuiz; gridSlot: ScheduleSlot; room: ScheduleRoom }): unknown
  /** Trailing actions inside an occupied quiz cell (e.g. delete button). */
  'cell-actions'(props: {
    quiz: ScheduledQuiz
    gridSlot: ScheduleSlot
    room: ScheduleRoom
  }): unknown
  /** Contents of an empty quiz cell (e.g. add button). */
  'empty-cell'(props: { gridSlot: ScheduleSlot; room: ScheduleRoom }): unknown
}>()

const grid = computed<Grid<ScheduledQuiz, ScheduleSlot, ScheduleRoom>>(() =>
  buildGrid(props.rooms, props.slots, props.quizzes, props.divisionFilter ?? null),
)

const days = computed<DayGroup<ScheduledQuiz, ScheduleSlot>[]>(() =>
  groupRowsByDay(grid.value.rows),
)

const empty = computed(() => !hasAnyQuiz(grid.value))

// Precomputed lookup maps so seat-team resolution is O(1) per seat
// instead of O(assignments + teams). Without these, rendering a meet
// with hundreds of seats does thousands of .find() scans per render.
const assignmentByDivisionLetter = computed(() => {
  const m = new Map<string, number>()
  for (const a of props.prelimAssignments ?? []) m.set(`${a.division}|${a.letter}`, a.teamId)
  return m
})
const teamById = computed(() => new Map((props.meetTeams ?? []).map((t) => [t.id, t])))

function seatTeamLabel(quiz: ScheduledQuiz, seat: ScheduledSeat): string {
  if (!seat.letter) return '—'
  const teamId = assignmentByDivisionLetter.value.get(`${quiz.division}|${seat.letter}`)
  if (teamId === undefined) return '—'
  const t = teamById.value.get(teamId)
  return t ? `${t.churchShortName} ${t.number}` : '—'
}
</script>

<template>
  <p v-if="rooms.length === 0" class="schedule-grid-empty">
    {{ emptyMessage ?? 'No rooms have been added to this meet yet.' }}
  </p>
  <p v-else-if="empty" class="schedule-grid-empty">
    {{ emptyMessage ?? 'No quizzes scheduled yet.' }}
  </p>

  <div v-else class="schedule-grid-scroll">
    <table class="schedule-grid-table">
      <thead>
        <tr>
          <th class="schedule-grid-time-col" scope="col">Time</th>
          <th
            v-for="room in grid.rooms"
            :key="room.id"
            :data-room-id="room.id"
            class="schedule-grid-room-col"
            scope="col"
          >
            {{ room.name }}
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="group in days" :key="group.dateKey">
          <tr class="schedule-grid-day-row">
            <th class="schedule-grid-day-label" :colspan="grid.rooms.length + 1" scope="colgroup">
              {{ group.label }}
            </th>
          </tr>
          <tr
            v-for="row in group.rows"
            :key="row.slot.id"
            :class="{ 'schedule-grid-event-row': row.slot.kind === 'event' }"
          >
            <th class="schedule-grid-time-col" scope="row">
              <slot name="time-cell" :grid-slot="row.slot">{{
                formatSlotTime(row.slot.startAt)
              }}</slot>
            </th>
            <td
              v-if="row.slot.kind === 'event'"
              class="schedule-grid-event-cell"
              :colspan="grid.rooms.length"
            >
              <span class="schedule-grid-event-label">
                {{ row.slot.eventLabel || 'Event' }}
              </span>
            </td>
            <template v-else>
              <td
                v-for="(quiz, i) in row.cells"
                :key="grid.rooms[i]!.id"
                class="schedule-grid-cell"
                :class="{ 'schedule-grid-cell--empty': !quiz }"
              >
                <article v-if="quiz" class="schedule-grid-quiz" :data-quiz-id="quiz.id">
                  <header class="schedule-grid-quiz-head">
                    <slot
                      name="quiz-label"
                      :quiz="quiz"
                      :grid-slot="row.slot"
                      :room="grid.rooms[i]!"
                    >
                      <span class="schedule-grid-quiz-label">{{ quiz.label }}</span>
                    </slot>
                    <slot
                      name="cell-actions"
                      :quiz="quiz"
                      :grid-slot="row.slot"
                      :room="grid.rooms[i]!"
                    />
                  </header>
                  <ol class="schedule-grid-seat-list">
                    <li
                      v-for="seat in sortedSeats(quiz.seats)"
                      :key="seat.id"
                      class="schedule-grid-seat"
                      :data-seat-letter="seat.letter || undefined"
                    >
                      <span class="schedule-grid-seat-ref">{{ seatRef(seat) }}</span>
                      <span class="schedule-grid-seat-team">{{ seatTeamLabel(quiz, seat) }}</span>
                    </li>
                  </ol>
                </article>
                <slot v-else name="empty-cell" :grid-slot="row.slot" :room="grid.rooms[i]!" />
              </td>
            </template>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.schedule-grid-empty {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin: 0;
}

.schedule-grid-scroll {
  overflow-x: auto;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
}

.schedule-grid-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.78rem;
  table-layout: fixed;
}

.schedule-grid-table th,
.schedule-grid-table td {
  border: 1px solid var(--color-border-alt);
  vertical-align: top;
}

.schedule-grid-table thead th {
  background: var(--color-bg-raised, var(--color-bg-warm));
  color: var(--color-text-faint);
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.5rem 0.875rem;
  text-align: center;
}

.schedule-grid-time-col {
  width: 7rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  background: var(--color-bg);
  padding: 0.55rem 0.875rem;
  text-align: center;
  position: sticky;
  left: 0;
  z-index: 1;
}

.schedule-grid-table tbody .schedule-grid-time-col {
  font-weight: 500;
  color: var(--color-text-muted);
}

.schedule-grid-table thead .schedule-grid-time-col {
  background: var(--color-bg-raised, var(--color-bg-warm));
}

.schedule-grid-room-col {
  min-width: 6.5rem;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--color-text);
  padding: 0.5rem 0.875rem;
  text-align: center;
}

.schedule-grid-day-row .schedule-grid-day-label {
  background: var(--color-bg-warm);
  color: var(--color-text-muted);
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.45rem 0.875rem;
  text-align: left;
}

.schedule-grid-event-row .schedule-grid-event-cell {
  background: var(--color-bg-warm);
  text-align: center;
  padding: 0.55rem 0.6rem;
}

.schedule-grid-event-label {
  font-style: italic;
  font-weight: 400;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

/* --schedule-grid-action-opacity cascades into slot content so consumers
   can render hover-revealed action buttons (e.g. add / delete) without
   needing :deep() across scoped-style boundaries. */
.schedule-grid-cell {
  min-width: 6.5rem;
  padding: 0;
  --schedule-grid-action-opacity: 0;
}

.schedule-grid-cell:hover,
.schedule-grid-cell:focus-within {
  --schedule-grid-action-opacity: 1;
}

.schedule-grid-cell--empty {
  background: transparent;
}

.schedule-grid-quiz {
  display: flex;
  flex-direction: column;
}

.schedule-grid-quiz-head {
  position: relative;
  font-weight: 600;
  font-size: 0.78rem;
  text-align: center;
  padding: 0.3rem 0.4rem 0.25rem;
  border-bottom: 1px solid var(--color-border-alt);
  color: var(--color-text);
}

.schedule-grid-quiz-label {
  font-weight: 600;
  font-size: 0.78rem;
}

.schedule-grid-seat-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.schedule-grid-seat {
  display: grid;
  grid-template-columns: minmax(0, 1.6rem) minmax(0, 1fr);
  gap: 0.4rem;
  align-items: baseline;
  padding: 0.18rem 0.45rem;
  border-top: 1px dotted var(--color-border-alt);
  font-variant-numeric: tabular-nums;
}

.schedule-grid-seat:first-child {
  border-top: none;
}

.schedule-grid-seat-ref {
  color: var(--color-text-muted);
  font-weight: 500;
}

.schedule-grid-seat-team {
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
