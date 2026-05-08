<script setup lang="ts">
import { computed } from 'vue'

import type { MeetRoom, MeetSlot, ScheduledQuiz, ScheduledQuizSeat } from '../api'
import { buildGrid, formatSlotTime, hasAnyQuiz } from '../scheduleGrid'

const props = withDefaults(
  defineProps<{
    rooms: MeetRoom[]
    slots: MeetSlot[]
    quizzes: ScheduledQuiz[]
    divisionFilter: string | null
    editMode?: boolean
  }>(),
  { editMode: false },
)

const emit = defineEmits<{
  (e: 'edit-slot', slot: MeetSlot): void
  (e: 'delete-slot', slotId: number): void
}>()

const grid = computed(() =>
  buildGrid(props.rooms, props.slots, props.quizzes, props.divisionFilter),
)
const isEmpty = computed(() => !hasAnyQuiz(grid.value))

/** Letter slot for prelims, seedRef for elims, blank otherwise.
 *  Single render path so future "follow team" highlighting hooks in here
 *  once seats start carrying teamIds (see #39 Roll Teams). */
function seatRef(seat: ScheduledQuizSeat): string {
  return seat.letter ?? seat.seedRef ?? ''
}

/** Resolved team name for a seat. Always '—' until #39 ships the
 *  prelim_assignments / seed_resolutions resolution layer. */
function seatTeam(_seat: ScheduledQuizSeat): string {
  return '—'
}
</script>

<template>
  <div v-if="grid.rooms.length === 0" class="schedule-empty">
    No rooms have been added to this meet yet.
  </div>

  <div v-else class="schedule-scroll">
    <table class="schedule-grid">
      <thead>
        <tr>
          <th class="time-col" scope="col">Time</th>
          <th
            v-for="room in grid.rooms"
            :key="room.id"
            :data-room-id="room.id"
            class="room-col"
            scope="col"
          >
            {{ room.name }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in grid.rows"
          :key="row.slot.id"
          :class="{ 'event-row': row.slot.kind === 'event' }"
        >
          <th class="time-col" scope="row">
            <div class="time-col-inner">
              <span class="time-text">{{ formatSlotTime(row.slot.startAt) }}</span>
              <div v-if="editMode" class="time-actions">
                <button
                  type="button"
                  class="row-action"
                  title="Edit slot"
                  @click="emit('edit-slot', row.slot)"
                >
                  ✎
                </button>
                <button
                  type="button"
                  class="row-action row-action--danger"
                  title="Delete slot"
                  @click="emit('delete-slot', row.slot.id)"
                >
                  ×
                </button>
              </div>
            </div>
          </th>
          <td v-if="row.slot.kind === 'event'" class="event-cell" :colspan="grid.rooms.length">
            {{ row.slot.eventLabel || 'Event' }}
          </td>
          <template v-else>
            <td v-for="(quiz, i) in row.cells" :key="grid.rooms[i]!.id" class="quiz-cell">
              <div v-if="quiz" class="quiz-card" :data-quiz-id="quiz.id">
                <div class="quiz-label">{{ quiz.label }}</div>
                <table class="seat-table">
                  <tbody>
                    <tr
                      v-for="seat in quiz.seats"
                      :key="seat.id"
                      class="seat-row"
                      :data-seat-letter="seat.letter || undefined"
                    >
                      <td class="seat-ref">{{ seatRef(seat) }}</td>
                      <td class="seat-team">{{ seatTeam(seat) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </td>
          </template>
        </tr>
      </tbody>
    </table>

    <p v-if="isEmpty && !editMode" class="schedule-state">No quizzes scheduled in this view.</p>
  </div>
</template>

<style scoped>
.schedule-empty,
.schedule-state {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  padding: 1rem 0;
  text-align: center;
}

.schedule-scroll {
  overflow-x: auto;
}

/* Datasheet aesthetic — tight cells, hairline borders, monospace numbers.
   Mirrors the dense per-quiz layout from docs/example-winkler-2026.md. */
.schedule-grid {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.78rem;
  table-layout: fixed;
}

.schedule-grid th,
.schedule-grid td {
  border: 1px solid var(--color-border-alt);
  padding: 0;
  vertical-align: top;
  text-align: left;
}

.time-col {
  width: 4.5rem;
  font-weight: 600;
  white-space: nowrap;
  background: var(--color-bg-raised);
  padding: 0;
  vertical-align: top;
  color: var(--color-text-muted);
}

.time-col-inner {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.35rem 0.5rem;
}

.time-actions {
  display: flex;
  gap: 0.15rem;
}

.row-action {
  background: none;
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 0 0.25rem;
  font: inherit;
  font-size: 0.8rem;
  line-height: 1.1;
  color: var(--color-text-faint);
  cursor: pointer;
}

.row-action:hover {
  border-color: var(--color-border);
  color: var(--color-text);
  background: var(--color-bg);
}

.row-action--danger:hover {
  color: var(--color-invalid, #c00);
  border-color: var(--color-invalid, #c00);
}

.room-col {
  font-weight: 600;
  background: var(--color-bg-raised);
  text-align: center;
  padding: 0.35rem 0.5rem;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}

.event-row .event-cell {
  background: var(--color-bg-warm);
  font-style: italic;
  text-align: left;
  color: var(--color-text-muted);
  padding: 0.4rem 0.6rem;
  letter-spacing: 0.02em;
}

.quiz-cell {
  min-width: 7rem;
}

.quiz-card {
  display: flex;
  flex-direction: column;
}

.quiz-label {
  font-weight: 600;
  text-align: center;
  padding: 0.3rem 0.4rem 0.2rem;
  border-bottom: 1px solid var(--color-border-alt);
  color: var(--color-text);
}

.seat-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.72rem;
}

.seat-table .seat-row td {
  border: none;
  border-top: 1px dotted var(--color-border-alt);
  padding: 0.18rem 0.4rem;
}
.seat-table .seat-row:first-child td {
  border-top: none;
}

.seat-ref {
  width: 2.6rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.seat-team {
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
