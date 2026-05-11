<script setup lang="ts">
import { computed } from 'vue'

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

const sortedSlots = computed(() => [...props.slots].sort(bySortOrder))

const quizSlotCount = computed(() => props.slots.filter((s) => s.kind === 'quiz').length)
const capacity = computed(() => quizSlotCount.value * props.rooms.length)
const headroom = computed(() => capacity.value - props.quizBudget)

/** Compose a "Round N" label for quiz slots, ordered by appearance. */
const roundNumbers = computed<Map<number, number>>(() => {
  const m = new Map<number, number>()
  let n = 0
  for (const s of sortedSlots.value) {
    if (s.kind === 'quiz') m.set(s.id, ++n)
  }
  return m
})

/** Local time `YYYY-MM-DDTHH:mm` for a `<input type="datetime-local">`. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function onTimeChange(slot: MeetSlot, event: Event) {
  const iso = fromDatetimeLocal((event.target as HTMLInputElement).value)
  if (!iso || iso === slot.startAt) return
  emit('update-slot', { slotId: slot.id, patch: { startAt: iso } })
}

function onDurationChange(slot: MeetSlot, event: Event) {
  const v = Number.parseInt((event.target as HTMLInputElement).value, 10)
  if (!Number.isFinite(v) || v <= 0 || v === slot.durationMinutes) return
  emit('update-slot', { slotId: slot.id, patch: { durationMinutes: v } })
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
            <th class="dur-col" scope="col">Mins</th>
            <th class="label-col" scope="col">Round / Event</th>
            <th v-if="editable" class="action-col no-print" scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="slots.length === 0">
            <td colspan="4" class="empty-row">No slots yet — add the first round below.</td>
          </tr>
          <tr
            v-for="slot in sortedSlots"
            :key="slot.id"
            :class="{ 'event-row': slot.kind === 'event' }"
          >
            <th class="time-col" scope="row">
              <input
                v-if="editable"
                class="time-input"
                type="datetime-local"
                :value="toDatetimeLocal(slot.startAt)"
                @change="onTimeChange(slot, $event)"
              />
              <span v-else>{{ formatSlotTime(slot.startAt) }}</span>
            </th>
            <td class="dur-col">
              <input
                v-if="editable"
                class="dur-input"
                type="number"
                min="1"
                step="1"
                :value="slot.durationMinutes"
                @change="onDurationChange(slot, $event)"
              />
              <span v-else>{{ slot.durationMinutes }}</span>
            </td>
            <td class="label-col">
              <span v-if="slot.kind === 'quiz'" class="round-label">
                Round {{ roundNumbers.get(slot.id) }}
              </span>
              <input
                v-else-if="editable"
                class="label-input"
                type="text"
                :value="slot.eventLabel ?? ''"
                placeholder="Event name"
                @change="onLabelChange(slot, $event)"
              />
              <span v-else class="event-label">{{ slot.eventLabel || 'Event' }}</span>
            </td>
            <td v-if="editable" class="action-col no-print">
              <button
                type="button"
                class="row-delete"
                :title="`Delete slot`"
                @click="deleteSlot(slot)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editable" class="add-actions no-print">
      <button type="button" class="add-btn" @click="addSlot('quiz')">+ Round</button>
      <button type="button" class="add-btn add-btn--event" @click="addSlot('event')">
        + Event
      </button>
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
  table-layout: fixed;
}

.schedule-table th,
.schedule-table td {
  border-bottom: 1px solid var(--color-border-alt);
  padding: 0.4rem 0.6rem;
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
}

.time-col {
  width: 11rem;
  font-variant-numeric: tabular-nums;
}

.dur-col {
  width: 5rem;
  font-variant-numeric: tabular-nums;
}

.label-col {
  font-weight: 500;
  color: var(--color-text);
}

.action-col {
  width: 2.5rem;
  text-align: right;
}

.event-row .label-col {
  color: var(--color-text-muted);
  font-style: italic;
}

.round-label {
  color: var(--color-text);
}

.empty-row {
  text-align: center;
  color: var(--color-text-faint);
  font-size: 0.85rem;
  padding: 1.25rem 0.6rem;
}

input.time-input,
input.dur-input,
input.label-input {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.2rem 0.4rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  width: 100%;
  min-width: 0;
}

input.dur-input {
  width: 3.25rem;
  text-align: right;
}

input.time-input:hover,
input.dur-input:hover,
input.label-input:hover {
  border-color: var(--color-border-alt);
}

input.time-input:focus,
input.dur-input:focus,
input.label-input:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-bg);
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
  background: var(--color-bg-raised);
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

.add-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.add-btn--event {
  flex: 0 0 auto;
}
</style>
