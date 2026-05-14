<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import {
  type MeetRoom,
  type MeetSlot,
  type MeetTeamRow,
  type PrelimAssignment,
  type ScheduledQuiz,
  type SeatInput,
} from '../../api'
import { buildGrid, formatSlotTime, hasAnyQuiz, seatRef, seatTeam } from '../../scheduleGrid'
import TimePickerButton from './TimePickerButton.vue'

interface PickerTime {
  hours: number
  minutes: number
  seconds?: number
}

interface AddQuizPayload {
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  seats: SeatInput[]
}

interface UpdateQuizPayload {
  quizId: number
  patch: { label?: string }
  seats: SeatInput[]
}

interface PopulateInfo {
  needed: number
  capacity: number
  ready: boolean
  note: string
}

interface RollInfo {
  ready: boolean
  perDivision: Array<{
    division: string
    needed: number
    present: number
    /** null when this division's prelim quizzes form a valid round-robin;
     *  otherwise a one-line reason it doesn't. */
    issue: string | null
  }>
  note: string
}

const props = defineProps<{
  rooms: MeetRoom[]
  slots: MeetSlot[]
  quizzes: ScheduledQuiz[]
  /** When true, each row's time becomes a picker and quiz cards get a
   *  delete button. Defaults to read-only. */
  editable?: boolean
  /** Override the section heading. Default "Review" suits the read-only
   *  view; "Draw" is more accurate when editing. */
  sectionTitle?: string
  /** When true, show the Populate / Roll Teams action cards. */
  canPopulate?: boolean
  /** Available divisions, used to populate the add-quiz form's
   *  division dropdown. */
  divisions?: string[]
  /** Capacity check + status for the Populate action card. */
  populateInfo?: PopulateInfo
  /** Prelim-coverage check + status for the Roll Teams action card. */
  rollInfo?: RollInfo
  /** Optional letter→team lookups; when provided, "Team" mode shows
   *  resolved team names instead of `—`. */
  prelimAssignments?: PrelimAssignment[]
  meetTeams?: MeetTeamRow[]
}>()

const emit = defineEmits<{
  (e: 'update-slot', payload: { slotId: number; patch: { startAt: string } }): void
  (e: 'delete-quiz', quizId: number): void
  (e: 'populate-skeleton'): void
  (e: 'roll-teams'): void
  (e: 'swap-late-teams'): void
  (e: 'add-quiz', payload: AddQuizPayload): void
  (e: 'update-quiz', payload: UpdateQuizPayload): void
}>()

const hasLateTeams = computed(() => (props.meetTeams ?? []).some((t) => t.lateness))

function confirmOverwrite(action: string): boolean {
  if (props.quizzes.length === 0) return true
  return confirm(
    `${action} will overwrite ${props.quizzes.length} existing quiz${props.quizzes.length === 1 ? '' : 'es'}. Continue?`,
  )
}

function onPopulate() {
  if (!confirmOverwrite('Populating the schedule')) return
  emit('populate-skeleton')
}

function onRoll() {
  if (!confirmOverwrite('Rolling teams')) return
  emit('roll-teams')
}

function onSwapLate() {
  emit('swap-late-teams')
}

const grid = computed(() => buildGrid(props.rooms, props.slots, props.quizzes, null))
const empty = computed(() => !hasAnyQuiz(grid.value))

/** Group grid rows by their slot's local date so the template can break
 *  the schedule into "Friday, May 15 / Saturday, May 16 / …" sections,
 *  matching the day grouping the Skeleton tab uses. */
interface DayGroup {
  dateKey: string
  label: string
  rows: typeof grid.value.rows
}
const days = computed<DayGroup[]>(() => {
  const map = new Map<string, DayGroup>()
  for (const row of grid.value.rows) {
    const d = new Date(row.slot.startAt)
    if (Number.isNaN(d.getTime())) continue
    const key = dateKey(d)
    let group = map.get(key)
    if (!group) {
      group = { dateKey: key, label: dayLabel(d), rows: [] }
      map.set(key, group)
    }
    group.rows.push(row)
  }
  return Array.from(map.values())
})

function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

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

/** When set, the add/edit quiz dialog is open for this cell. quiz=null
 *  means "add a new quiz here"; quiz=existing means "edit". */
const editingCell = ref<{
  slot: MeetSlot
  room: MeetRoom
  quiz: ScheduledQuiz | null
} | null>(null)

const editForm = reactive({
  division: '',
  phase: 'prelim' as 'prelim' | 'elim',
  label: '',
  seats: [
    { seatNumber: 1, letter: 'A' },
    { seatNumber: 2, letter: 'B' },
    { seatNumber: 3, letter: 'C' },
  ] as { seatNumber: number; letter: string }[],
})

function openEditDialog(slot: MeetSlot, room: MeetRoom, quiz: ScheduledQuiz | null) {
  if (!props.editable) return
  editingCell.value = { slot, room, quiz }
  if (quiz) {
    editForm.division = quiz.division
    editForm.phase = quiz.phase
    editForm.label = quiz.label
    const sorted = sortedSeats(quiz)
    editForm.seats = [1, 2, 3].map((n) => {
      const existing = sorted.find((s) => s.seatNumber === n)
      return { seatNumber: n, letter: existing?.letter ?? '' }
    })
  } else {
    const div = props.divisions?.[0] ?? props.quizzes[0]?.division ?? ''
    editForm.division = div
    editForm.phase = 'prelim'
    editForm.label = div ? defaultQuizLabel(div, 'prelim') : ''
    editForm.seats = [
      { seatNumber: 1, letter: 'A' },
      { seatNumber: 2, letter: 'B' },
      { seatNumber: 3, letter: 'C' },
    ]
  }
}

/** Suggested label for a new quiz card. Prelims are numbered, elims are
 *  lettered (matching the populate convention). */
function defaultQuizLabel(division: string, phase: 'prelim' | 'elim'): string {
  if (phase === 'prelim') {
    const used = new Set<number>()
    for (const q of props.quizzes) {
      if (q.division !== division || q.phase !== 'prelim') continue
      const m = q.label.match(/(\d+)\s*$/)
      if (m) used.add(Number(m[1]))
    }
    let n = 1
    while (used.has(n)) n++
    return `D${division}-Q${n}`
  }
  const used = new Set<string>()
  for (const q of props.quizzes) {
    if (q.division !== division || q.phase !== 'elim') continue
    const m = q.label.match(/([A-Z])\s*$/)
    if (m) used.add(m[1]!)
  }
  let code = 65
  while (used.has(String.fromCharCode(code))) code++
  return `D${division}-Q${String.fromCharCode(code)}`
}

function closeEditDialog() {
  editingCell.value = null
}

/** When user switches phase or division while adding a new quiz, refresh
 *  the suggested label so the format keeps matching the chosen phase. */
watch(
  () => [editForm.division, editForm.phase] as const,
  ([div, phase]) => {
    if (!editingCell.value || editingCell.value.quiz || !div) return
    editForm.label = defaultQuizLabel(div, phase)
  },
)

function saveEdit() {
  if (!editingCell.value) return
  const { slot, room, quiz } = editingCell.value
  const seats: SeatInput[] = editForm.seats.map((s) => ({
    seatNumber: s.seatNumber,
    letter: s.letter || null,
  }))
  if (quiz) {
    const patch: { label?: string } = {}
    if (editForm.label !== quiz.label) patch.label = editForm.label
    emit('update-quiz', { quizId: quiz.id, patch, seats })
  } else {
    if (!editForm.division) {
      alert('Pick a division')
      return
    }
    emit('add-quiz', {
      slotId: slot.id,
      roomId: room.id,
      division: editForm.division,
      phase: editForm.phase,
      label: editForm.label,
      seats,
    })
  }
  closeEditDialog()
}
</script>

<template>
  <section class="section">
    <div class="section-header">
      <h3 class="section-title">{{ sectionTitle ?? 'Review' }}</h3>
      <span class="section-meta">
        {{ slots.length }} slots · {{ rooms.length }} rooms · {{ quizzes.length }} quizzes
      </span>
    </div>

    <div v-if="canPopulate" class="draw-actions no-print">
      <article class="action-card" :class="{ 'is-ready': populateInfo?.ready }">
        <header class="action-head">
          <h4 class="action-title">Populate</h4>
          <span class="action-state">{{ populateInfo?.ready ? '✓ Ready' : '✗ Not ready' }}</span>
        </header>
        <p class="action-desc">
          Creates a quiz card for every prelim and elim quiz, labelled
          <code>{div} Qz {n}</code>, across the slot×room grid.
        </p>
        <dl class="action-stats">
          <div>
            <dt>Cells needed</dt>
            <dd>{{ populateInfo?.needed ?? 0 }}</dd>
          </div>
          <div>
            <dt>Cells available</dt>
            <dd>{{ populateInfo?.capacity ?? 0 }}</dd>
          </div>
        </dl>
        <p class="action-note">{{ populateInfo?.note }}</p>
        <button
          type="button"
          class="action-btn"
          :disabled="!populateInfo?.ready"
          @click="onPopulate"
        >
          Populate
        </button>
      </article>

      <article class="action-card" :class="{ 'is-ready': rollInfo?.ready }">
        <header class="action-head">
          <h4 class="action-title">Roll teams</h4>
          <span class="action-state">{{ rollInfo?.ready ? '✓ Ready' : '✗ Not ready' }}</span>
        </header>
        <p class="action-desc">
          Assigns teams to A/B/C seats in every prelim quiz using a balanced round-robin so each
          team plays every other team roughly evenly.
        </p>
        <dl v-if="rollInfo?.perDivision.length" class="action-stats action-stats--divisions">
          <div
            v-for="d in rollInfo.perDivision"
            :key="d.division"
            :class="{ 'action-stat--ok': d.issue === null }"
          >
            <dt>
              Div {{ d.division }}
              <span class="action-stat-flag">{{ d.issue === null ? '✓' : '✗' }}</span>
            </dt>
            <dd>{{ d.present }} / {{ d.needed }} prelims</dd>
          </div>
        </dl>
        <p class="action-note">{{ rollInfo?.note }}</p>
        <button type="button" class="action-btn" :disabled="!rollInfo?.ready" @click="onRoll">
          Roll teams
        </button>
      </article>

      <article v-if="hasLateTeams" class="action-card">
        <header class="action-head">
          <h4 class="action-title">Push late teams</h4>
        </header>
        <p class="action-desc">
          Swaps prelim quizzes (slot only — labels and seats stay put) so any quiz containing a team
          marked <em>Late</em> moves to a later round. Won't put a team in two rooms at once.
        </p>
        <p class="action-note">Run after Roll Teams — uses the current letter→team mapping.</p>
        <button type="button" class="action-btn" @click="onSwapLate">Push late teams later</button>
      </article>
    </div>

    <p v-if="rooms.length === 0" class="empty">No rooms have been added to this meet yet.</p>
    <p v-else-if="empty" class="empty">No quizzes scheduled yet. Add slots and quizzes to begin.</p>

    <div v-else class="schedule-scroll">
      <table class="schedule-table">
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
          <template v-for="group in days" :key="group.dateKey">
            <tr class="day-row">
              <th class="day-label" :colspan="grid.rooms.length + 1" scope="colgroup">
                {{ group.label }}
              </th>
            </tr>
            <tr
              v-for="row in group.rows"
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
                  :class="{ 'quiz-cell--empty': !quiz, 'quiz-cell--editable': editable }"
                >
                  <article v-if="quiz" class="quiz" :data-quiz-id="quiz.id">
                    <header class="quiz-head">
                      <button
                        v-if="editable"
                        type="button"
                        class="quiz-label-btn"
                        :title="`Edit ${quiz.label}`"
                        @click="openEditDialog(row.slot, grid.rooms[i]!, quiz)"
                      >
                        {{ quiz.label }}
                      </button>
                      <span v-else class="quiz-label">{{ quiz.label }}</span>
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
                        <span class="seat-team">{{
                          seatTeam(seat, {
                            division: quiz.division,
                            assignments: prelimAssignments ?? [],
                            teams: meetTeams ?? [],
                          })
                        }}</span>
                      </li>
                    </ol>
                  </article>
                  <button
                    v-else-if="editable"
                    type="button"
                    class="quiz-add no-print"
                    :title="`Add quiz at ${formatSlotTime(row.slot.startAt)} in ${grid.rooms[i]!.name}`"
                    @click="openEditDialog(row.slot, grid.rooms[i]!, null)"
                  >
                    +
                  </button>
                </td>
              </template>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="editingCell" class="edit-overlay no-print" @click.self="closeEditDialog">
      <form class="edit-form" @submit.prevent="saveEdit">
        <h4 class="edit-title">
          {{ editingCell.quiz ? 'Edit quiz' : 'Add quiz' }} —
          {{ formatSlotTime(editingCell.slot.startAt) }}, {{ editingCell.room.name }}
        </h4>
        <label class="edit-row">
          <span>Division</span>
          <select v-model="editForm.division" :disabled="!!editingCell.quiz">
            <option v-for="d in divisions ?? []" :key="d" :value="d">Div {{ d }}</option>
          </select>
        </label>
        <label class="edit-row">
          <span>Phase</span>
          <select v-model="editForm.phase" :disabled="!!editingCell.quiz">
            <option value="prelim">Prelim</option>
            <option value="elim">Elim</option>
          </select>
        </label>
        <label class="edit-row">
          <span>Label</span>
          <input v-model="editForm.label" type="text" required />
        </label>
        <fieldset class="edit-seats">
          <legend>Seats</legend>
          <label v-for="seat in editForm.seats" :key="seat.seatNumber" class="edit-seat">
            <span>{{ seat.seatNumber }}</span>
            <input
              v-model="seat.letter"
              type="text"
              maxlength="3"
              :placeholder="String.fromCharCode(64 + seat.seatNumber)"
            />
          </label>
        </fieldset>
        <div class="edit-actions">
          <button type="button" class="edit-btn" @click="closeEditDialog">Cancel</button>
          <button type="submit" class="edit-btn edit-btn--primary">Save</button>
        </div>
      </form>
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

.draw-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.action-card {
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
  padding: 0.85rem 1rem 0.95rem;
  background: var(--color-bg-raised);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.action-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.action-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-heading);
}

.action-state {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--palette-error);
  text-transform: uppercase;
}

.action-card.is-ready .action-state {
  color: var(--color-correct);
}

.action-desc {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-muted);
  line-height: 1.45;
}

.action-desc code {
  font-size: 0.78rem;
  color: var(--color-text);
  font-family: inherit;
}

.action-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem 1.25rem;
  margin: 0;
}

.action-stats > div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 5rem;
}

.action-stats dt {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
}

.action-stats dd {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.action-stats--divisions > div dd {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.action-stat-flag {
  margin-left: 0.2rem;
  color: var(--palette-error);
}

.action-stats--divisions > .action-stat--ok .action-stat-flag {
  color: var(--color-correct);
}

.action-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-text-faint);
  font-style: italic;
}

.action-card.is-ready .action-note {
  color: var(--color-text-muted);
  font-style: normal;
}

.action-btn {
  align-self: flex-start;
  background: var(--color-accent);
  color: var(--color-bg);
  border: 0;
  border-radius: 5px;
  padding: 0.4rem 0.95rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.action-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.action-btn:disabled {
  background: var(--color-bg);
  color: var(--color-text-faint);
  border: 1px solid var(--color-border-alt);
  cursor: not-allowed;
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

.day-row .day-label {
  background: var(--color-bg-warm);
  color: var(--color-text-muted);
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.45rem 0.875rem;
  text-align: left;
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

.quiz-label-btn {
  background: none;
  border: 0;
  font: inherit;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--color-text);
  cursor: pointer;
  padding: 0;
  border-radius: 3px;
}

.quiz-label-btn:hover {
  color: var(--color-accent);
}

.quiz-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 2.5rem;
  background: none;
  border: 0;
  font: inherit;
  font-size: 1.1rem;
  color: var(--color-text-faint);
  cursor: pointer;
  opacity: 0;
  transition: opacity 100ms ease;
}

.quiz-cell--editable:hover .quiz-add,
.quiz-add:focus-visible {
  opacity: 1;
  color: var(--color-accent);
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

/* Inline modal for the quiz add/edit form. Centered overlay with a
   click-outside-to-close backdrop. */
.edit-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.edit-form {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 22rem;
  max-width: 28rem;
  font-size: 0.85rem;
}

.edit-title {
  margin: 0 0 0.25rem;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-heading);
}

.edit-row {
  display: grid;
  grid-template-columns: 5rem 1fr;
  align-items: center;
  gap: 0.65rem;
}

.edit-row > span {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.edit-row select,
.edit-row input,
.edit-seat input {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
}

.edit-row input:focus,
.edit-row select:focus,
.edit-seat input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.edit-seats {
  display: flex;
  gap: 0.5rem;
  border: 0;
  padding: 0;
  margin: 0;
}

.edit-seats legend {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 0.35rem;
  padding: 0;
}

.edit-seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
  font-size: 0.7rem;
  color: var(--color-text-faint);
}

.edit-seat input {
  width: 100%;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.edit-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.4rem 0.85rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text);
  cursor: pointer;
}

.edit-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.edit-btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-bg);
}

.edit-btn--primary:hover {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
  color: var(--color-bg);
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
