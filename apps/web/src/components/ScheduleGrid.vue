<script setup lang="ts">
import { computed } from 'vue'

import type { MeetRoom, MeetSlot, ScheduledQuiz, ScheduledQuizSeat } from '../api'
import { buildGrid, formatSlotTime, hasAnyQuiz } from '../scheduleGrid'

const props = defineProps<{
  rooms: MeetRoom[]
  slots: MeetSlot[]
  quizzes: ScheduledQuiz[]
  divisionFilter: string | null
}>()

const grid = computed(() =>
  buildGrid(props.rooms, props.slots, props.quizzes, props.divisionFilter),
)
const isEmpty = computed(() => !hasAnyQuiz(grid.value))

/**
 * Single render path for a seat chip. Future "follow team" highlighting hooks
 * in here once seats start carrying teamIds (see #39 Roll Teams).
 */
function seatLabel(seat: ScheduledQuizSeat): string {
  return seat.letter ?? seat.seedRef ?? '?'
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
          <th class="time-col" scope="row">{{ formatSlotTime(row.slot.startAt) }}</th>
          <td v-if="row.slot.kind === 'event'" class="event-cell" :colspan="grid.rooms.length">
            {{ row.slot.eventLabel || 'Event' }}
          </td>
          <template v-else>
            <td v-for="(quiz, i) in row.cells" :key="grid.rooms[i]!.id" class="quiz-cell">
              <div v-if="quiz" class="quiz-card" :data-quiz-id="quiz.id">
                <div class="quiz-label">{{ quiz.label }}</div>
                <ul class="seat-list">
                  <li
                    v-for="seat in quiz.seats"
                    :key="seat.id"
                    class="seat-chip"
                    :data-seat-letter="seat.letter || undefined"
                  >
                    {{ seatLabel(seat) }}
                  </li>
                </ul>
              </div>
            </td>
          </template>
        </tr>
      </tbody>
    </table>

    <p v-if="isEmpty" class="schedule-state">No quizzes scheduled in this view.</p>
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

.schedule-grid {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85rem;
}

.schedule-grid th,
.schedule-grid td {
  border: 1px solid var(--color-border-alt);
  padding: 0.4rem 0.6rem;
  vertical-align: top;
  text-align: left;
}

.time-col {
  width: 5rem;
  font-weight: 600;
  white-space: nowrap;
  background: var(--color-bg-raised);
}

.room-col {
  font-weight: 600;
  background: var(--color-bg-raised);
  text-align: center;
}

.event-row .event-cell {
  background: var(--color-bg-warm);
  font-style: italic;
  text-align: center;
  color: var(--color-text-muted);
}

.quiz-cell {
  min-width: 8rem;
}

.quiz-card {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.quiz-label {
  font-weight: 600;
  font-size: 0.8rem;
}

.seat-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.seat-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6rem;
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.75rem;
  background: var(--color-bg);
}
</style>
