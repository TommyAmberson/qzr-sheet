<script setup lang="ts">
import { computed } from 'vue'
import {
  formatClock,
  roomDivisions,
  seatText,
  sheetRows,
  type Conflict,
  type ScheduleDocument,
  type ScheduleQuiz,
  type Seat,
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

/** The team on a seat's line: a drawn team in Teams view, else blank for the meet to fill in */
function seatTeam(quiz: ScheduleQuiz, seat: Seat) {
  return props.view === 'teams' && seat.kind === 'letter'
    ? seatText(props.doc, quiz, seat, 'teams')
    : ''
}

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

/** Each division's colour, by its place in the settings, for the tick on its quizzes */
const divisionClass = computed(() => {
  const order = new Map(props.doc.settings.divisions.map((d, i) => [d.id, `d${(i % 4) + 1}`]))
  return (id: string) => order.get(id) ?? 'd1'
})
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
            :data-cell="`${r.row.id}|${c.kind === 'event' ? c.rooms[0] : c.room}`"
          >
            <!-- A quiz an event clashes with still shows, marked, so it can be moved (H-3) -->
            <div
              v-if="c.kind === 'quiz'"
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
                  @click="emit('quiz', c.quiz.id, target($event))"
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
                :title="seatText(doc, c.quiz, seat, 'letters')"
                @click="emit('seat', c.quiz.id, i, target($event))"
              >
                <!-- Where the seat comes from, its bench colour, and the line its team goes on -->
                <span class="src" :class="{ choose: seat.kind === 'empty' }">{{
                  seatText(doc, c.quiz, seat, 'letters')
                }}</span>
                <span class="bench" :class="`bench-${i}`" />
                <span class="line">{{ seatTeam(c.quiz, seat) }}</span>
              </button>
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
              {{ c.event.label }}
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
  display: grid;
  /* The line centred under the quiz's title, as on paper, its source hanging to the left */
  grid-template-columns: minmax(0, 1fr) 3px min(7rem, 50%) minmax(0, 1fr);
  align-items: end;
  column-gap: 0.3rem;
  line-height: 1.25;
  width: 100%;
  min-width: 12rem;
  padding: 0.1rem 0 0;
  border-radius: 0;
  color: var(--color-text, #2a2724);
  font-size: 0.8rem;
  text-align: left;
}

/* The scoresheet's benches, in seat order: red, white, blue, as a slim bar at the line's start */
.bench {
  height: 1em;
  margin-bottom: 0.15em;
  width: 3px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text, #2a2724) 25%, transparent);
}

.bench-0 {
  background: var(--color-team-red, #e02424);
}

.bench-1 {
  background: var(--color-team-white, #fff);
}

.bench-2 {
  background: var(--color-team-blue, #1d4ed8);
}

/* Ends at the bar; a long source spills left rather than being cut short */
.src {
  justify-self: end;
  color: var(--color-text, #2a2724);
  font-family: var(--sheet-mono);
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}

.src.choose {
  color: var(--color-accent, #2563eb);
  font-family: inherit;
  font-style: italic;
  font-weight: 500;
}

.line {
  min-height: 1.2em;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--color-text, #2a2724) 30%, transparent);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet .seat:hover .line {
  border-bottom-color: var(--qc);
  background: color-mix(in srgb, var(--qc) 12%, transparent);
}

.sheet .seat:hover .src {
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
    width: 100%;
    min-width: 0;
    color: #000;
    font-size: 8pt;
  }

  .line {
    border-bottom: 0.75pt solid #000;
  }

  .src {
    color: #000;
    font-size: 7.5pt;
  }

  .src.choose {
    color: #777;
  }

  .bench {
    box-shadow: inset 0 0 0 0.5pt #000;
    print-color-adjust: exact;
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
