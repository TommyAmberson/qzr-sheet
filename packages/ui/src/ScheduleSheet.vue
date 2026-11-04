<script setup lang="ts">
import { computed } from 'vue'
import {
  formatClock,
  roomDivisions,
  seatText,
  sheetRows,
  type Conflict,
  type ScheduleDocument,
  type SheetView,
} from '@qzr/shared'

/**
 * A schedule laid out as the org's printouts are: a time column, a column per room, day headings,
 * events across the rooms, and each quiz's title over its seats. The portal, printing and the
 * builder all draw it; the builder adds its editing through the events.
 */
const props = withDefaults(
  defineProps<{
    doc: ScheduleDocument
    view?: SheetView
    /** Conflicts by quiz id, to mark their cells (FR-037) */
    issues?: Map<string, Conflict[]>
    /** The quiz the builder has selected */
    selected?: string | null
  }>(),
  { view: 'letters', issues: () => new Map(), selected: null },
)

const emit = defineEmits<{
  quiz: [id: string, el: HTMLElement]
  seat: [quiz: string, index: number, el: HTMLElement]
  cell: [slot: string, room: string, el: HTMLElement]
  row: [id: string, el: HTMLElement]
  room: [id: string, el: HTMLElement]
}>()

const rows = computed(() => sheetRows(props.doc))
const columns = computed(() => props.doc.rooms.length)

function issueText(id: string): string {
  return (props.issues.get(id) ?? []).map((c) => `${c.rule}: ${c.reason}`).join('\n')
}
function hasHard(id: string) {
  return (props.issues.get(id) ?? []).some((c) => !c.warning)
}
function hasWarning(id: string) {
  return (props.issues.get(id) ?? []).some((c) => c.warning)
}
const target = (e: Event) => e.currentTarget as HTMLElement
</script>

<template>
  <table class="sheet">
    <thead>
      <tr>
        <th class="time" />
        <th v-for="room in doc.rooms" :key="room.id" class="room">
          <button type="button" class="room-name" @click="emit('room', room.id, target($event))">
            {{ room.name }}
          </button>
          <span class="room-divisions">{{ roomDivisions(doc, room.id).join(', ') }}</span>
        </th>
      </tr>
    </thead>
    <tbody>
      <template v-for="r in rows" :key="r.row.id">
        <tr v-if="r.kind === 'day'" class="day">
          <th :colspan="columns + 1">{{ r.row.label }}</th>
        </tr>
        <tr v-else-if="r.kind === 'note'" class="note">
          <td :colspan="columns + 1">
            <button type="button" class="row-button" @click="emit('row', r.row.id, target($event))">
              {{ r.row.text }}
            </button>
          </td>
        </tr>
        <tr v-else-if="r.kind === 'event'" class="event">
          <td class="time">
            <button type="button" class="row-button" @click="emit('row', r.row.id, target($event))">
              {{ formatClock(r.row.at) }}
            </button>
          </td>
          <td :colspan="columns">{{ r.row.label }}</td>
        </tr>
        <tr v-else class="slot">
          <td class="time">
            <button type="button" class="row-button" @click="emit('row', r.row.id, target($event))">
              {{ formatClock(r.row.at) }}
            </button>
          </td>
          <td v-for="c in r.cells" :key="c.room" class="cell" :data-cell="`${r.row.id}|${c.room}`">
            <!-- A quiz an event clashes with still shows, marked, so it can be moved (H-3) -->
            <div
              v-if="c.quiz"
              class="quiz"
              :class="{
                conflict: hasHard(c.quiz.id),
                warning: !hasHard(c.quiz.id) && hasWarning(c.quiz.id),
                selected: selected === c.quiz.id,
                pinned: c.quiz.pinned,
              }"
              :data-quiz="c.quiz.id"
              :title="issueText(c.quiz.id) || undefined"
            >
              <!-- A reader's page can make the title a link instead, the portal's to the scoresheet -->
              <slot name="quiz-title" :quiz="c.quiz">
                <button
                  type="button"
                  class="quiz-title"
                  @click="emit('quiz', c.quiz!.id, target($event))"
                >
                  {{ c.quiz.label }}
                </button>
              </slot>
              <button
                v-for="(seat, i) in c.quiz.seats"
                :key="i"
                type="button"
                class="seat"
                :data-seat="`${c.quiz.id}:${i}`"
                @click="emit('seat', c.quiz!.id, i, target($event))"
              >
                {{ seatText(doc, c.quiz, seat, view) }}
              </button>
            </div>
            <div v-else-if="c.event" class="room-event">{{ c.event }}</div>
            <button
              v-else
              type="button"
              class="empty-cell"
              :aria-label="`Empty cell`"
              @click="emit('cell', r.row.id, c.room, target($event))"
            />
          </td>
        </tr>
      </template>
    </tbody>
  </table>
</template>

<style scoped>
.sheet {
  border-collapse: collapse;
  font-size: 0.85rem;
}

th,
td {
  border-bottom: 1px solid var(--color-border, #ddd);
  padding: 0.25rem 0.5rem;
  vertical-align: top;
}

.time {
  position: sticky;
  left: 0;
  background: var(--color-bg, #fff);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.room {
  min-width: 10rem;
  text-align: center;
}

.room-divisions {
  display: block;
  font-weight: normal;
  font-size: 0.75rem;
  color: var(--color-text-muted, #666);
}

.day th {
  text-align: left;
  padding-top: 1rem;
}

.event td,
.note td {
  font-style: italic;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.quiz {
  display: grid;
  justify-items: center;
  gap: 0.1rem;
  padding: 0.25rem;
  border-radius: 6px;
}

.quiz-title {
  font-weight: 600;
}

.seat {
  min-width: 6rem;
  border-bottom: 1px solid currentColor;
}

.quiz.conflict {
  box-shadow: 0 0 0 2px var(--color-danger, #c33);
}

.quiz.warning {
  box-shadow: 0 0 0 2px var(--color-warn, #c90);
}

.quiz.selected {
  box-shadow: 0 0 0 2px var(--color-accent, #36c);
}

.quiz.pinned {
  outline: 1px dashed var(--color-text-muted, #666);
}

.empty-cell {
  width: 100%;
  min-height: 3rem;
}

.room-event {
  font-style: italic;
  text-align: center;
}

/* One or more pages per day, the time column and room headers on each, no quiz split (FR-044) */
@media print {
  button {
    cursor: default;
  }

  .day:not(:first-child) {
    break-before: page;
  }

  tr {
    break-inside: avoid;
  }

  .empty-cell {
    display: none;
  }
}
</style>
