<script setup lang="ts">
import { computed } from 'vue'
import ScheduleSeat from './ScheduleSeat.vue'
import { divisionColourVar } from './divisionColour'
import {
  formatClock,
  roomDivisions,
  sheetRows,
  type Conflict,
  type ScheduleDocument,
  type ScheduleQuiz,
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
    /** The builder's grid, whose empty cells offer to add a quiz */
    editable?: boolean
  }>(),
  { view: 'letters', issues: () => new Map(), selected: null, editable: false },
)

const emit = defineEmits<{
  quiz: [id: string, el: HTMLElement]
  seat: [quiz: string, index: number, el: HTMLElement]
  cell: [slot: string, room: string, el: HTMLElement]
  row: [id: string, el: HTMLElement]
  room: [id: string, el: HTMLElement]
  event: [id: string, el: HTMLElement]
}>()

const rows = computed(() => sheetRows(props.doc))

/** Days with quizzes, which each start a printed page; a day of only events follows on */
const quizDays = computed(() => {
  const days = new Set<string>()
  let day: string | null = null
  for (const r of rows.value) {
    if (r.kind === 'day') day = r.row.id
    else if (day && r.kind === 'slot' && r.cells.some((c) => c.kind === 'quiz')) days.add(day)
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

/** Each division's colour, its own or by its place, for the tick on its quizzes */
const colourOf = (division: string) => divisionColourVar(props.doc, division)

/** How much of its division's colour each lane's tick takes, as Elim settings shades the lanes */
const LANE_SHARE = [100, 55, 32, 16]
/** A quiz's tick: its division's colour, paler in each lane below the main one */
function tickOf(quiz: ScheduleQuiz) {
  const lane = quiz.phase === 'elim' && quiz.line === undefined ? (quiz.lane ?? 0) : 0
  const base = colourOf(quiz.division)
  if (lane === 0) return base
  const share = LANE_SHARE[Math.min(lane, LANE_SHARE.length - 1)]!
  return `color-mix(in srgb, ${base} ${share}%, var(--color-bg, #fff))`
}
</script>

<template>
  <table class="sheet" :class="{ editable }">
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
        <!-- A row of only events is drawn short, as the paper schedules draw Lunch (FR-017) -->
        <tr v-else class="slot" :class="{ event: r.short }">
          <td class="time">
            <button type="button" class="row-button" @click="emit('row', r.row.id, target($event))">
              {{ formatClock(r.row.at) }}
            </button>
          </td>
          <td
            v-for="(c, ci) in r.cells"
            :key="c.kind === 'event' ? `${c.event.id}:${ci}` : c.room"
            :colspan="c.kind === 'event' ? c.rooms.length : undefined"
            class="cell"
            :class="{ 'event-cell': c.kind === 'event' }"
            :data-cell="`${r.row.id}|${c.kind === 'event' ? c.rooms[0] : c.room}`"
          >
            <!-- A quiz an event clashes with still shows, marked, so it can be moved (H-3) -->
            <div
              v-if="c.kind === 'quiz'"
              class="quiz"
              :class="{
                conflict: hasHard(c.quiz.id),
                warning: !hasHard(c.quiz.id) && hasWarning(c.quiz.id),
                selected: selected === c.quiz.id,
                pinned: c.quiz.pinned,
              }"
              :data-quiz="c.quiz.id"
              :style="{ '--qc': colourOf(c.quiz.division), '--qt': tickOf(c.quiz) }"
              :title="issueText(c.quiz.id) || undefined"
            >
              <!-- A reader's page can make the title a link instead, the portal's to the scoresheet -->
              <slot name="quiz-title" :quiz="c.quiz">
                <button
                  type="button"
                  class="quiz-title"
                  @click="emit('quiz', c.quiz.id, target($event))"
                >
                  {{ c.quiz.label }}
                </button>
              </slot>
              <ScheduleSeat
                v-for="(_, i) in c.quiz.seats"
                :key="i"
                class="seat"
                :doc="doc"
                :quiz="c.quiz"
                :index="i"
                :view="view"
                @click="emit('seat', c.quiz.id, i, target($event))"
              />
            </div>
            <button
              v-else-if="c.kind === 'event'"
              type="button"
              :class="[
                r.short ? 'event-name' : 'room-event',
                { selected: selected === c.event.id },
              ]"
              :data-event="c.event.id"
              @click="emit('event', c.event.id, target($event))"
            >
              <span class="event-label">{{ c.event.label }}</span>
            </button>
            <button
              v-else
              type="button"
              class="empty-cell"
              :aria-label="editable ? 'Add a quiz or event here' : 'Empty cell'"
              @click="emit('cell', r.row.id, c.room, target($event))"
            >
              <span v-if="editable" class="add" aria-hidden="true">+</span>
            </button>
          </td>
        </tr>
      </template>
    </tbody>
    <tfoot v-if="$slots['days-end']" class="days-end">
      <tr>
        <td :colspan="columns + 1">
          <slot name="days-end" />
        </td>
      </tr>
    </tfoot>
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

  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--color-meta-accent, #c9c0a8);
  border-radius: 6px;
  background: var(--color-bg, #fff);
  font-size: 0.85rem;
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

/* Day and note labels, and a long event's name, stay in view when the grid scrolls sideways */
.day .row-button,
.note .row-button {
  position: sticky;
  left: 0.6rem;
  display: inline-block;
}

.event-name .event-label {
  position: sticky;
  left: calc(5.5rem + 1.25rem);
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

/* An event's cell, in a short row or beside quizzes, striped as the paper schedules shade them */
.sheet .event-cell {
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
  --qc: var(--dc-green);

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

/* The division's tick, paler for a consolation lane and ringed so it still shows */
.sheet .quiz-title::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--qt, var(--qc));
  box-shadow: 0 0 0 1px var(--qc);
}

/* Room for a long source beside a centred line */
.sheet .seat {
  min-width: 12rem;
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
  display: grid;
  width: 100%;
  min-height: 5.2rem;
  border-radius: 5px;
}

.sheet .empty-cell .add {
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  margin: auto;
  border: 1px dashed var(--color-meta-accent, #c9c0a8);
  border-radius: 50%;
  color: var(--color-text-muted, #57534e);
  font-size: 1rem;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.12s;
}

.sheet.editable .empty-cell:hover,
.sheet.editable .empty-cell:focus-visible {
  background: var(--color-meta-bg, #f0e8e0);
}

.sheet .empty-cell:hover .add,
.sheet .empty-cell:focus-visible .add {
  opacity: 1;
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
}

/* A short row's empty rooms stay as short as its events */
.event .empty-cell {
  min-height: 1.4em;
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
    --sheet-rule: #888;
  }

  /* Rules in points and fixed ink: a 1px hairline in a dark-mode colour drops out of a PDF view */
  .sheet th,
  .sheet td {
    padding: 2pt 3pt;
    border-bottom: 0.75pt solid var(--sheet-rule);
    color: #000;
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
    border-right: 0.75pt solid var(--sheet-rule);
  }

  .sheet .time .row-button {
    font-size: 7.5pt;
  }

  .sheet .seat {
    min-width: 0;
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
  .rooms-end,
  .days-end {
    display: none;
  }

  .quiz.conflict,
  .quiz.warning {
    background: none;
  }
}
</style>
