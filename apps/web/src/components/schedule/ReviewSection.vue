<script setup lang="ts">
import { computed, ref } from 'vue'

import { type MeetRoom, type MeetSlot, type ScheduledQuiz, type ScheduledQuizSeat } from '../../api'
import { buildGrid, formatSlotTime, hasAnyQuiz } from '../../scheduleGrid'

const props = defineProps<{
  rooms: MeetRoom[]
  slots: MeetSlot[]
  quizzes: ScheduledQuiz[]
}>()

type Mode = 'letter' | 'team'

const mode = ref<Mode>('letter')

const grid = computed(() => buildGrid(props.rooms, props.slots, props.quizzes, null))
const empty = computed(() => !hasAnyQuiz(grid.value))

/** Letter for prelim seats, seedRef for elim seats. The canonical seat
 *  identifier shown in letter mode. */
function seatRef(seat: ScheduledQuizSeat): string {
  return seat.letter ?? seat.seedRef ?? ''
}

/** Resolved team name. Always `—` until #39 Roll Teams ships the
 *  prelim_assignments / seed_resolutions resolution layer. */
function seatTeam(_seat: ScheduledQuizSeat): string {
  return '—'
}

function sortedSeats(quiz: ScheduledQuiz) {
  return [...quiz.seats].sort((a, b) => a.seatNumber - b.seatNumber)
}
</script>

<template>
  <section class="schedule-section">
    <header class="section-head">
      <h2 class="section-title">Schedule</h2>
      <p class="section-meta">
        <span>{{ slots.length }} slots</span>
        <span class="rule" aria-hidden="true">/</span>
        <span>{{ rooms.length }} rooms</span>
        <span class="rule" aria-hidden="true">/</span>
        <span>{{ quizzes.length }} quizzes</span>
      </p>
      <div class="mode-toggle no-print" role="tablist" aria-label="Schedule view mode">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'letter'"
          :class="{ 'is-active': mode === 'letter' }"
          @click="mode = 'letter'"
        >
          Letter
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'team'"
          :class="{ 'is-active': mode === 'team' }"
          @click="mode = 'team'"
        >
          Team
        </button>
      </div>
    </header>

    <p v-if="rooms.length === 0" class="schedule-empty">
      No rooms have been added to this meet yet.
    </p>
    <p v-else-if="empty" class="schedule-empty">
      No quizzes scheduled yet. Add slots and quizzes to begin.
    </p>

    <div v-else class="schedule-scroll">
      <table class="schedule-table" :data-mode="mode">
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
              {{ formatSlotTime(row.slot.startAt) }}
            </th>
            <td v-if="row.slot.kind === 'event'" class="event-cell" :colspan="grid.rooms.length">
              <span class="event-label">{{ row.slot.eventLabel || 'Event' }}</span>
            </td>
            <template v-else>
              <td
                v-for="(quiz, i) in row.cells"
                :key="grid.rooms[i]!.id"
                class="quiz-cell"
                :class="{ 'quiz-cell--empty': !quiz }"
              >
                <article v-if="quiz" class="quiz" :data-quiz-id="quiz.id">
                  <header class="quiz-head">{{ quiz.label }}</header>
                  <ol class="seat-list">
                    <li
                      v-for="seat in sortedSeats(quiz)"
                      :key="seat.id"
                      class="seat"
                      :data-seat-letter="seat.letter || undefined"
                    >
                      <span class="seat-ref">{{ seatRef(seat) }}</span>
                      <span v-if="mode === 'team'" class="seat-team">{{ seatTeam(seat) }}</span>
                    </li>
                  </ol>
                </article>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.schedule-section {
  padding: 1.5rem 0 1rem;
  border-top: 2px solid var(--color-text);
  margin-top: 1.5rem;
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.section-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.55rem;
  margin: 0;
  letter-spacing: -0.015em;
  color: var(--color-heading);
  flex-shrink: 0;
}

.section-meta {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.5rem;
}

.rule {
  color: var(--color-border);
}

.mode-toggle {
  margin-left: auto;
  display: inline-flex;
  border: 1px solid var(--color-border);
}

.mode-toggle button {
  background: none;
  border: none;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.3rem 0.7rem;
  border-right: 1px solid var(--color-border);
}

.mode-toggle button:last-child {
  border-right: none;
}

.mode-toggle button:hover {
  color: var(--color-text);
}

.mode-toggle button.is-active {
  background: var(--color-text);
  color: var(--color-bg);
}

.schedule-empty {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 1rem;
  color: var(--color-text-muted);
  margin: 0;
}

.schedule-scroll {
  overflow-x: auto;
}

.schedule-table {
  border-collapse: collapse;
  width: 100%;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  table-layout: fixed;
}

.schedule-table th,
.schedule-table td {
  border: 1px solid var(--color-border-alt);
  padding: 0;
  vertical-align: top;
  text-align: left;
}

.time-col {
  width: 4.25rem;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  font-size: 0.78rem;
  white-space: nowrap;
  background: var(--color-bg);
  color: var(--color-text-muted);
  padding: 0.4rem 0.55rem;
  position: sticky;
  left: 0;
  z-index: 1;
}

thead .time-col {
  background: var(--color-bg-raised);
  color: var(--color-text-faint);
  font-weight: 600;
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.room-col {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.82rem;
  text-align: center;
  background: var(--color-bg-raised);
  padding: 0.4rem 0.5rem;
  letter-spacing: 0.01em;
  color: var(--color-text);
  min-width: 6.5rem;
}

.event-row .event-cell {
  background: var(--color-bg-warm);
  text-align: center;
  padding: 0.55rem 0.6rem;
}

.event-label {
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 400;
  font-size: 0.95rem;
  letter-spacing: 0.01em;
  color: var(--color-text-muted);
}

.quiz-cell {
  min-width: 6.5rem;
}

.quiz-cell--empty {
  background: transparent;
}

.quiz {
  display: flex;
  flex-direction: column;
}

.quiz-head {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.85rem;
  text-align: center;
  padding: 0.3rem 0.4rem 0.25rem;
  border-bottom: 1px solid var(--color-border-alt);
  color: var(--color-text);
  letter-spacing: -0.005em;
}

.seat-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.seat {
  display: grid;
  grid-template-columns: minmax(0, 1.6rem) minmax(0, 1fr);
  gap: 0.4rem;
  align-items: baseline;
  padding: 0.18rem 0.45rem;
  border-top: 1px dotted var(--color-border-alt);
  font-variant-numeric: tabular-nums;
}

.seat:first-child {
  border-top: none;
}

.seat-ref {
  color: var(--color-text-muted);
  font-weight: 500;
}

.seat-team {
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.schedule-table[data-mode='letter'] .seat {
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
}

@media print {
  .no-print {
    display: none !important;
  }
  .schedule-scroll {
    overflow: visible;
  }
  .schedule-table {
    font-size: 0.7rem;
  }
  .time-col {
    position: static;
  }
}
</style>
