<script setup lang="ts">
import { computed, ref } from 'vue'

import { type MeetRoom, type MeetSlot, type ScheduledQuiz } from '../../api'
import { buildGrid, formatSlotTime, hasAnyQuiz, seatRef, seatTeam } from '../../scheduleGrid'
import TimePickerButton from './TimePickerButton.vue'

interface PickerTime {
  hours: number
  minutes: number
  seconds?: number
}

const props = defineProps<{
  rooms: MeetRoom[]
  slots: MeetSlot[]
  quizzes: ScheduledQuiz[]
  /** When true, each row's time becomes a picker and quiz cards get a
   *  delete button. Defaults to read-only. */
  editable?: boolean
}>()

const emit = defineEmits<{
  (e: 'update-slot', payload: { slotId: number; patch: { startAt: string } }): void
  (e: 'delete-quiz', quizId: number): void
}>()

type Mode = 'letter' | 'team'

const mode = ref<Mode>('letter')

const grid = computed(() => buildGrid(props.rooms, props.slots, props.quizzes, null))
const empty = computed(() => !hasAnyQuiz(grid.value))

function sortedSeats(quiz: ScheduledQuiz) {
  return [...quiz.seats].sort((a, b) => a.seatNumber - b.seatNumber)
}

function slotTimeModel(iso: string): PickerTime {
  const d = new Date(iso)
  return { hours: d.getHours(), minutes: d.getMinutes() }
}

/** Update one slot's start time directly — no cascade. Time edits in
 *  Review are surgical adjustments; bulk shifts live in Skeleton's
 *  duration/anchor handlers. */
function onSlotTimeChange(slot: MeetSlot, value: PickerTime | null) {
  if (!value) return
  const d = new Date(slot.startAt)
  d.setHours(value.hours, value.minutes, 0, 0)
  const next = d.toISOString()
  if (next === slot.startAt) return
  emit('update-slot', { slotId: slot.id, patch: { startAt: next } })
}

function onDeleteQuiz(quiz: ScheduledQuiz) {
  if (!confirm(`Delete ${quiz.label}?`)) return
  emit('delete-quiz', quiz.id)
}
</script>

<template>
  <section class="section">
    <div class="section-header">
      <h3 class="section-title">Review</h3>
      <span class="section-meta">
        {{ slots.length }} slots · {{ rooms.length }} rooms · {{ quizzes.length }} quizzes
      </span>
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
    </div>

    <p v-if="rooms.length === 0" class="empty">No rooms have been added to this meet yet.</p>
    <p v-else-if="empty" class="empty">No quizzes scheduled yet. Add slots and quizzes to begin.</p>

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
              <TimePickerButton
                v-if="editable"
                :model-value="slotTimeModel(row.slot.startAt)"
                :title="`Change time for ${formatSlotTime(row.slot.startAt)}`"
                @update:model-value="onSlotTimeChange(row.slot, $event)"
              >
                {{ formatSlotTime(row.slot.startAt) }}
              </TimePickerButton>
              <template v-else>{{ formatSlotTime(row.slot.startAt) }}</template>
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
                  <header class="quiz-head">
                    <span class="quiz-label">{{ quiz.label }}</span>
                    <button
                      v-if="editable"
                      type="button"
                      class="quiz-delete no-print"
                      :title="`Delete ${quiz.label}`"
                      @click="onDeleteQuiz(quiz)"
                    >
                      ×
                    </button>
                  </header>
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
.section {
  margin-bottom: 2rem;
}

.section-header {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
}

.section-meta {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
}

.mode-toggle {
  margin-left: auto;
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  overflow: hidden;
}

.mode-toggle button {
  background: none;
  border: none;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.25rem 0.65rem;
  border-right: 1px solid var(--color-border);
}

.mode-toggle button:last-child {
  border-right: none;
}

.mode-toggle button:hover {
  color: var(--color-text);
}

.mode-toggle button.is-active {
  background: var(--color-accent);
  color: var(--color-bg);
}

.empty {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin: 0;
}

.schedule-scroll {
  overflow-x: auto;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
}

.schedule-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.78rem;
  table-layout: fixed;
}

/* No padding/text-align on the parent rule — per-column class rules
   below would lose the cascade ((0,1,0) vs (0,1,1)) and silently do
   nothing. Each column class sets its own. */
.schedule-table th,
.schedule-table td {
  border: 1px solid var(--color-border-alt);
  vertical-align: top;
}

thead th {
  background: var(--color-bg-raised);
  color: var(--color-text-faint);
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.5rem 0.875rem;
  text-align: center;
}

.time-col {
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

/* Body-only — keep header (.time-col in thead) faint/uppercase via thead th. */
tbody .time-col {
  font-weight: 500;
  color: var(--color-text-muted);
}

thead .time-col {
  background: var(--color-bg-raised);
}

.room-col {
  min-width: 6.5rem;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--color-text);
  padding: 0.5rem 0.875rem;
  text-align: center;
}

.event-row .event-cell {
  background: var(--color-bg-warm);
  text-align: center;
  padding: 0.55rem 0.6rem;
}

.event-label {
  font-style: italic;
  font-weight: 400;
  font-size: 0.85rem;
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
  position: relative;
  font-weight: 600;
  font-size: 0.78rem;
  text-align: center;
  padding: 0.3rem 0.4rem 0.25rem;
  border-bottom: 1px solid var(--color-border-alt);
  color: var(--color-text);
}

.quiz-delete {
  position: absolute;
  top: 0.05rem;
  right: 0.2rem;
  background: none;
  border: 0;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.1rem 0.25rem;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 100ms ease;
}

.quiz:hover .quiz-delete,
.quiz-delete:focus-visible {
  opacity: 1;
}

.quiz-delete:hover {
  color: var(--palette-error);
  background: var(--color-bg);
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
