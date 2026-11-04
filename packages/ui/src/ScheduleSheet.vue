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

/** Days with quizzes, which each start a printed page; a day of only events follows on */
const quizDays = computed(() => {
  const days = new Set<string>()
  let day: string | null = null
  for (const r of rows.value) {
    if (r.kind === 'day') day = r.row.id
    else if (day && r.kind === 'slot' && r.cells.some((c) => c.quiz)) days.add(day)
  }
  return days
})
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

/** Each division's colour, by its place in the settings, for the tick on its quizzes */
const divisionClass = computed(() => {
  const order = new Map(props.doc.settings.divisions.map((d, i) => [d.id, `d${(i % 4) + 1}`]))
  return (id: string) => order.get(id) ?? 'd1'
})
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
          <!-- Plain text for print: a repeated page header drops a button's text -->
          <span class="room-print">{{ room.name }}</span>
          <span class="room-divisions">{{ roomDivisions(doc, room.id).join(', ') }}</span>
        </th>
        <!-- An editing page adds its own header cell, the builder's + Room -->
        <th v-if="$slots['rooms-end']" class="rooms-end">
          <slot name="rooms-end" />
        </th>
      </tr>
    </thead>
    <tbody>
      <template v-for="r in rows" :key="r.row.id">
        <tr v-if="r.kind === 'day'" class="day" :class="{ 'quiz-day': quizDays.has(r.row.id) }">
          <th :colspan="columns + 1">
            <button type="button" class="row-button" @click="emit('row', r.row.id, target($event))">
              {{ r.row.label }}
            </button>
          </th>
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
          <td :colspan="columns">
            <!-- The event's name opens its menu too, as its time does -->
            <button type="button" class="event-name" @click="emit('row', r.row.id, target($event))">
              {{ r.row.label }}
            </button>
          </td>
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
                [divisionClass(c.quiz.division)]: true,
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
            <button
              v-else-if="c.event"
              type="button"
              class="room-event"
              @click="emit('row', c.eventId!, target($event))"
            >
              {{ c.event }}
            </button>
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
/*
 * The schedule as a printed tournament programme: an ink-ruled sheet, heavy rules under each day,
 * times and seat letters in a typewriter face, each quiz a centred title over three ruled seats,
 * and a coloured tick saying whose division it is.
 */
.sheet {
  --sheet-ink: var(--color-heading, #33302a);
  --sheet-rule: var(--color-border-alt, #e0ddd4);
  --sheet-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace;
  --d1: #2f9e6e;
  --d2: #c2416b;
  --d3: #c27c0e;
  --d4: #7a5af5;

  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--color-meta-accent, #c9c0a8);
  border-radius: 6px;
  background: var(--color-bg, #fff);
  font-size: 0.85rem;
}

@media (prefers-color-scheme: dark) {
  .sheet {
    --d1: #4fd1a0;
    --d2: #f08aa6;
    --d3: #f0b452;
    --d4: #a996ff;
  }
}

.sheet th,
.sheet td {
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--sheet-rule);
  vertical-align: top;
}

/* Plain text that happens to be clickable: no button chrome anywhere in the sheet */
.sheet button {
  display: inline;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: none;
  box-shadow: none;
  color: inherit;
  font: inherit;
  text-align: inherit;
  cursor: pointer;
}

.sheet button:hover {
  background: var(--color-meta-bg, #f0e8e0);
}

/* ---- Header: a tan bar per room, as the scoresheet heads each team ---- */

.sheet thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 0.45rem 0.5rem 0.35rem;
  border-bottom: 1.5px solid var(--sheet-ink);
  background: var(--color-meta-bg, #f0e8e0);
}

.sheet thead th:first-child {
  border-top-left-radius: 6px;
}

.sheet thead th:last-child {
  border-top-right-radius: 6px;
}

.room {
  min-width: 9.5rem;
  text-align: center;
}

.sheet .room-name {
  padding: 0 0.3rem;
  color: var(--sheet-ink);
  font-weight: 700;
}

.room-print {
  display: none;
}

.rooms-end {
  width: 1%;
  vertical-align: middle;
  white-space: nowrap;
}

.room-divisions {
  display: block;
  color: var(--color-text-faint, #78716c);
  font-size: 0.7rem;
  font-weight: 500;
}

/* ---- Rows ---- */

.time {
  position: sticky;
  left: 0;
  z-index: 1;
  width: 5.5rem;
  border-right: 1px solid var(--sheet-rule);
  background: var(--color-bg, #fff);
  white-space: nowrap;
}

.sheet .time .row-button {
  padding: 0.1rem 0.25rem;
  color: var(--color-text-muted, #57534e);
  font-family: var(--sheet-mono);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.day th {
  padding: 1.1rem 0.6rem 0.3rem;
  border-bottom: 1.5px solid var(--sheet-ink);
  color: var(--sheet-ink);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-align: left;
  text-transform: uppercase;
}

.event td,
.note td {
  color: var(--color-text-muted, #57534e);
  font-style: italic;
}

.event td:not(.time) {
  background: repeating-linear-gradient(
    -45deg,
    transparent 0 7px,
    color-mix(in srgb, var(--color-meta-accent, #c9c0a8) 18%, transparent) 7px 14px
  );
  color: var(--sheet-ink);
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* ---- Quizzes: a centred title over three ruled seats ---- */

.cell {
  padding: 0.35rem 0.4rem;
}

.quiz {
  --qc: var(--d1);

  position: relative;
  display: grid;
  justify-items: center;
  gap: 0.15rem;
  padding: 0.3rem 0.45rem 0.4rem;
  border-radius: 5px;
  transition:
    background 0.12s,
    box-shadow 0.12s;
}

.quiz.d2 {
  --qc: var(--d2);
}

.quiz.d3 {
  --qc: var(--d3);
}

.quiz.d4 {
  --qc: var(--d4);
}

.quiz:hover {
  box-shadow: inset 0 0 0 1px var(--color-meta-accent, #c9c0a8);
}

.sheet .quiz-title {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.25rem;
  color: var(--sheet-ink);
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
}

/* The division's tick */
.sheet .quiz-title::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--qc);
}

.sheet .seat {
  display: block;
  width: 100%;
  min-width: 6.5rem;
  padding: 0.05rem 0.3rem 0;
  border-bottom: 1px solid var(--color-text, #2a2724);
  border-radius: 0;
  color: var(--color-text, #2a2724);
  font-family: var(--sheet-mono);
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
}

.sheet .seat:hover {
  border-bottom-color: var(--qc);
  background: color-mix(in srgb, var(--qc) 12%, transparent);
  color: var(--qc);
}

/* A pinned quiz carries a small mark in its corner */
.quiz.pinned::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 4px;
  width: 0;
  height: 0;
  border-top: 7px solid var(--color-accent, #60a5fa);
  border-left: 7px solid transparent;
}

.quiz.conflict {
  background: var(--color-danger-bg, #f2e4e2);
  box-shadow: inset 0 0 0 1.5px var(--color-danger, #8b4038);
}

.quiz.warning {
  background: var(--color-warn-bg, #faf0dc);
  box-shadow: inset 0 0 0 1.5px var(--color-warn, #c47a1a);
}

.quiz.selected {
  box-shadow: 0 0 0 2px var(--color-accent, #60a5fa);
}

.sheet .empty-cell {
  display: block;
  width: 100%;
  min-height: 5.2rem;
  border-radius: 5px;
}

.sheet .empty-cell:hover {
  background: var(--color-meta-bg, #f0e8e0);
  box-shadow: inset 0 0 0 1px dashed var(--color-meta-accent, #c9c0a8);
}

.sheet .event-name {
  display: block;
  width: 100%;
  padding: 0 0.25rem;
  text-align: left;
}

.sheet .room-event {
  width: 100%;
  display: grid;
  place-items: center;
  min-height: 5.2rem;
  border-radius: 5px;
  background: color-mix(in srgb, var(--color-meta-accent, #c9c0a8) 18%, transparent);
  color: var(--color-text-muted, #57534e);
  font-style: italic;
}

/*
 * One or more landscape pages per day, every room across the page, the time column and room
 * headers on each page, and no quiz split between pages (FR-044)
 */
@page grid {
  size: landscape;
  margin: 10mm;
}

@media print {
  .sheet {
    page: grid;
    width: 100%;
    table-layout: fixed;
    border: 0;
    background: #fff;
    font-size: 8.5pt;
    --sheet-ink: #000;
    --sheet-rule: #bbb;
  }

  .sheet th,
  .sheet td {
    padding: 2pt 3pt;
  }

  .sheet thead th {
    position: static;
    background: #eee;
  }

  .room {
    min-width: 0;
  }

  .sheet .room-name {
    display: none;
  }

  .room-print {
    display: block;
    font-weight: 700;
  }

  .time {
    position: static;
    width: 6.5em;
  }

  .sheet .time .row-button {
    font-size: 7.5pt;
  }

  .sheet .seat {
    min-width: 0;
    font-size: 8pt;
  }

  .sheet .quiz-title {
    font-size: 8pt;
    white-space: normal;
  }

  .sheet button {
    cursor: default;
  }

  .day.quiz-day:not(:first-child) {
    break-before: page;
  }

  .day {
    break-after: avoid;
  }

  tr {
    break-inside: avoid;
  }

  .sheet .empty-cell,
  .room-event,
  .quiz.pinned::after {
    min-height: 0;
  }

  .sheet .empty-cell,
  .quiz.pinned::after,
  .rooms-end {
    display: none;
  }

  .quiz.conflict,
  .quiz.warning {
    background: none;
  }
}
</style>
