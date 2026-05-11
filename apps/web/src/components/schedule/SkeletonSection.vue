<script setup lang="ts">
import { computed, ref } from 'vue'

import { type MeetRoom, type MeetSlot } from '../../api'
import { bySortOrder, formatSlotTime } from '../../scheduleGrid'

const props = defineProps<{
  rooms: MeetRoom[]
  slots: MeetSlot[]
  /** Threaded from parent so the capacity sentence reflects the same
   *  budget the Elim setup section computed. */
  quizBudget: number
  editable: boolean
}>()

const emit = defineEmits<{
  (e: 'create-slot', payload: CreateSlotPayload): void
  (e: 'update-slot', payload: { slotId: number; patch: UpdateSlotPatch }): void
  (e: 'delete-slot', slotId: number): void
}>()

interface CreateSlotPayload {
  startAt: string
  durationMinutes: number
  kind: 'quiz' | 'event'
  eventLabel: string | null
  sortOrder: number
}

interface UpdateSlotPatch {
  startAt?: string
  durationMinutes?: number
  eventLabel?: string | null
}

interface DayGroup {
  /** Local-time YYYY-MM-DD for grouping. */
  dateKey: string
  /** Human-readable header label ("Friday, May 15"). */
  label: string
  slots: MeetSlot[]
}

const sortedSlots = computed(() => [...props.slots].sort(bySortOrder))

const quizSlotCount = computed(() => props.slots.filter((s) => s.kind === 'quiz').length)
const capacity = computed(() => quizSlotCount.value * props.rooms.length)
const headroom = computed(() => capacity.value - props.quizBudget)

/** Group slots by local date so we can show day headers and gate
 *  time-edit to the first slot of each day. */
const days = computed<DayGroup[]>(() => {
  const map = new Map<string, DayGroup>()
  for (const s of sortedSlots.value) {
    const d = new Date(s.startAt)
    if (Number.isNaN(d.getTime())) continue
    const key = dateKey(d)
    let group = map.get(key)
    if (!group) {
      group = { dateKey: key, label: dayLabel(d), slots: [] }
      map.set(key, group)
    }
    group.slots.push(s)
  }
  return Array.from(map.values())
})

/** Quiz slot → "Round N" by global order. */
const roundNumbers = computed<Map<number, number>>(() => {
  const m = new Map<number, number>()
  let n = 0
  for (const s of sortedSlots.value) {
    if (s.kind === 'quiz') m.set(s.id, ++n)
  }
  return m
})

/** Number of body columns the slot-content cell spans. At least one even
 *  if no rooms are defined yet, so the table doesn't collapse. */
const contentColspan = computed(() => Math.max(1, props.rooms.length))

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

function timeOfDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Combine the date portion of `iso` with `HH:mm` into a new ISO string. */
function withTimeOfDay(iso: string, hhmm: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  d.setHours(h!, m!, 0, 0)
  return d.toISOString()
}

// Refs for the hidden time inputs that we trigger via showPicker(). One
// per day anchor; the picker UI is the native control, but the visible
// affordance is a styled button.
const timeInputs = ref(new Map<number, HTMLInputElement>())

function registerTimeInput(slotId: number, el: HTMLInputElement | null) {
  if (el) timeInputs.value.set(slotId, el)
  else timeInputs.value.delete(slotId)
}

function openTimePicker(slotId: number) {
  const input = timeInputs.value.get(slotId)
  if (!input) return
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker()
      return
    } catch {
      // Fall through to focus.
    }
  }
  input.focus()
  input.click()
}

/** When the day-anchor moves, shift every slot in that day by the same
 *  delta. Keeps each slot's relative position in the chain stable. */
function onAnchorTimeChange(group: DayGroup, event: Event) {
  const hhmm = (event.target as HTMLInputElement).value
  const anchor = group.slots[0]
  if (!anchor) return
  const newStart = withTimeOfDay(anchor.startAt, hhmm)
  if (!newStart || newStart === anchor.startAt) return
  const delta = new Date(newStart).getTime() - new Date(anchor.startAt).getTime()
  for (const s of group.slots) {
    const shifted = new Date(new Date(s.startAt).getTime() + delta).toISOString()
    emit('update-slot', { slotId: s.id, patch: { startAt: shifted } })
  }
}

/** Duration change cascades: this slot's duration moves, every subsequent
 *  same-day slot shifts by the delta to keep the chain consistent. */
function onDurationChange(group: DayGroup, slot: MeetSlot, event: Event) {
  const next = Number.parseInt((event.target as HTMLInputElement).value, 10)
  if (!Number.isFinite(next) || next <= 0 || next === slot.durationMinutes) return
  emit('update-slot', { slotId: slot.id, patch: { durationMinutes: next } })
  const delta = (next - slot.durationMinutes) * 60_000
  const i = group.slots.findIndex((s) => s.id === slot.id)
  for (const s of group.slots.slice(i + 1)) {
    const shifted = new Date(new Date(s.startAt).getTime() + delta).toISOString()
    emit('update-slot', { slotId: s.id, patch: { startAt: shifted } })
  }
}

function onLabelChange(slot: MeetSlot, event: Event) {
  if (slot.kind !== 'event') return
  const label = (event.target as HTMLInputElement).value.trim() || null
  if (label === slot.eventLabel) return
  emit('update-slot', { slotId: slot.id, patch: { eventLabel: label } })
}

function addSlot(kind: 'quiz' | 'event') {
  const last = sortedSlots.value[sortedSlots.value.length - 1]
  const startAt = last
    ? new Date(new Date(last.startAt).getTime() + last.durationMinutes * 60_000).toISOString()
    : new Date().toISOString()
  const durationMinutes = last?.durationMinutes ?? 25
  const sortOrder = (last?.sortOrder ?? -1) + 1
  emit('create-slot', {
    startAt,
    durationMinutes,
    kind,
    eventLabel: kind === 'event' ? '' : null,
    sortOrder,
  })
}

function addDay() {
  const last = sortedSlots.value[sortedSlots.value.length - 1]
  const base = last ? new Date(last.startAt) : new Date()
  const next = new Date(base)
  next.setDate(next.getDate() + 1)
  next.setHours(8, 0, 0, 0)
  const sortOrder = (last?.sortOrder ?? -1) + 1
  emit('create-slot', {
    startAt: next.toISOString(),
    durationMinutes: 25,
    kind: 'quiz',
    eventLabel: null,
    sortOrder,
  })
}

function deleteSlot(slot: MeetSlot) {
  const label =
    slot.kind === 'event'
      ? slot.eventLabel || 'this event'
      : `the ${formatSlotTime(slot.startAt)} round`
  if (!confirm(`Delete ${label}?`)) return
  emit('delete-slot', slot.id)
}
</script>

<template>
  <section class="section">
    <div class="section-header">
      <h3 class="section-title">Skeleton</h3>
      <span class="section-meta">
        {{ slots.length }} slots · {{ quizSlotCount }} quiz rounds · {{ rooms.length }} rooms
      </span>
    </div>

    <p v-if="slots.length > 0" class="capacity" :class="headroom < 0 ? 'is-short' : 'is-spare'">
      <strong>{{ rooms.length }}</strong> rooms × <strong>{{ quizSlotCount }}</strong> quiz slots =
      <strong>{{ capacity }}</strong> cells · budget <strong>{{ quizBudget }}</strong> ·
      <strong>{{ Math.abs(headroom) }}</strong> cells {{ headroom < 0 ? 'short' : 'to spare' }}
    </p>

    <div v-if="rooms.length === 0 && slots.length === 0" class="empty">
      Add rooms in the meet dashboard, then build the timeline here.
    </div>

    <div v-else class="schedule-scroll">
      <table class="schedule-table">
        <thead>
          <tr>
            <th class="time-col" scope="col">Time</th>
            <th v-if="rooms.length === 0" class="room-col" scope="col">Slot</th>
            <th
              v-for="room in rooms"
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
          <tr v-if="slots.length === 0">
            <td :colspan="contentColspan + 1" class="empty-row">No slots yet — add a day below.</td>
          </tr>
          <template v-for="group in days" :key="group.dateKey">
            <tr class="day-row">
              <th class="day-label" :colspan="contentColspan + 1" scope="colgroup">
                {{ group.label }}
              </th>
            </tr>
            <tr
              v-for="(slot, idx) in group.slots"
              :key="slot.id"
              :class="{ 'event-row': slot.kind === 'event' }"
            >
              <th class="time-col" scope="row">
                <template v-if="idx === 0 && editable">
                  <button
                    type="button"
                    class="time-button"
                    :title="`Change start time for ${group.label}`"
                    @click="openTimePicker(slot.id)"
                  >
                    <span>{{ formatSlotTime(slot.startAt) }}</span>
                    <span class="time-button-icon" aria-hidden="true">✎</span>
                  </button>
                  <input
                    :ref="(el) => registerTimeInput(slot.id, el as HTMLInputElement | null)"
                    type="time"
                    class="hidden-picker"
                    :value="timeOfDay(slot.startAt)"
                    @change="onAnchorTimeChange(group, $event)"
                  />
                </template>
                <span v-else class="time-text">{{ formatSlotTime(slot.startAt) }}</span>
              </th>
              <td class="slot-cell" :colspan="contentColspan">
                <div class="slot-inner">
                  <span v-if="slot.kind === 'quiz'" class="slot-label">
                    Round {{ roundNumbers.get(slot.id) }}
                  </span>
                  <input
                    v-else-if="editable"
                    class="event-input"
                    type="text"
                    :value="slot.eventLabel ?? ''"
                    placeholder="Event name"
                    @change="onLabelChange(slot, $event)"
                  />
                  <span v-else class="slot-label slot-label--event">
                    {{ slot.eventLabel || 'Event' }}
                  </span>

                  <span class="slot-duration">
                    <input
                      v-if="editable"
                      class="dur-input"
                      type="number"
                      min="1"
                      step="1"
                      :value="slot.durationMinutes"
                      :aria-label="`Duration in minutes`"
                      @change="onDurationChange(group, slot, $event)"
                    />
                    <span v-else>{{ slot.durationMinutes }}</span>
                    <span class="dur-label">min</span>
                  </span>

                  <button
                    v-if="editable"
                    type="button"
                    class="row-delete no-print"
                    title="Delete slot"
                    @click="deleteSlot(slot)"
                  >
                    ×
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="editable" class="add-actions no-print">
      <button type="button" class="add-btn" :disabled="days.length === 0" @click="addSlot('quiz')">
        + Round
      </button>
      <button type="button" class="add-btn" :disabled="days.length === 0" @click="addSlot('event')">
        + Event
      </button>
      <button type="button" class="add-btn add-btn--day" @click="addDay">+ Day</button>
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
  justify-content: space-between;
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

.capacity {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin: 0 0 1rem;
  padding: 0.6rem 0.85rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
  line-height: 1.55;
}

.capacity strong {
  color: var(--color-text);
  font-weight: 600;
}

.capacity.is-short strong:last-of-type {
  color: var(--palette-error);
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
  font-size: 0.85rem;
  table-layout: auto;
}

.schedule-table th,
.schedule-table td {
  border-bottom: 1px solid var(--color-border-alt);
  padding: 0;
  vertical-align: middle;
  text-align: left;
}

.schedule-table tr:last-child th,
.schedule-table tr:last-child td {
  border-bottom: none;
}

thead th {
  background: var(--color-bg-raised);
  color: var(--color-text-faint);
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.4rem 0.6rem;
}

.time-col {
  width: 7rem;
  font-variant-numeric: tabular-nums;
  background: var(--color-bg);
  padding: 0.4rem 0.6rem;
  font-weight: 500;
}

thead .time-col {
  background: var(--color-bg-raised);
}

.time-text {
  color: var(--color-text);
}

.room-col {
  text-align: center;
  min-width: 6.5rem;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--color-text);
}

.day-row .day-label {
  background: var(--color-bg-warm);
  color: var(--color-text-muted);
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.4rem 0.6rem;
  text-align: left;
}

.slot-cell {
  padding: 0;
  background: var(--color-bg-raised);
}

.event-row .slot-cell {
  background: var(--color-bg-warm);
}

.slot-inner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.875rem;
}

.slot-label {
  flex: 1;
  font-weight: 600;
  color: var(--color-text);
  text-align: center;
  font-size: 0.92rem;
}

.slot-label--event {
  font-style: italic;
  font-weight: 500;
  color: var(--color-text-muted);
}

.slot-duration {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.dur-label {
  color: var(--color-text-faint);
  font-size: 0.72rem;
}

.empty-row {
  text-align: center;
  color: var(--color-text-faint);
  font-size: 0.85rem;
  padding: 1.25rem 0.6rem;
  background: var(--color-bg);
}

.time-button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  color: var(--color-text);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
}

.time-button:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.time-button-icon {
  font-size: 0.7rem;
  color: var(--color-text-faint);
}

.hidden-picker {
  position: absolute;
  width: 0;
  height: 0;
  padding: 0;
  margin: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.event-input {
  flex: 1;
  font: inherit;
  font-size: 0.92rem;
  font-style: italic;
  text-align: center;
  padding: 0.2rem 0.6rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  min-width: 0;
}

.event-input:hover {
  border-color: var(--color-border-alt);
  background: var(--color-bg);
}

.event-input:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-bg);
}

.dur-input {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
  text-align: right;
  font-variant-numeric: tabular-nums;
  width: 3rem;
}

.dur-input:hover {
  border-color: var(--color-text-muted);
}

.dur-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}

.row-delete {
  background: none;
  border: none;
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  border-radius: 4px;
}

.row-delete:hover {
  color: var(--palette-error);
  background: var(--color-bg);
}

.add-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.75rem;
}

.add-btn {
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  padding: 0.4rem 0.85rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-faint);
  cursor: pointer;
  flex: 1;
}

.add-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.add-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.add-btn--day {
  flex: 0 0 auto;
}
</style>
