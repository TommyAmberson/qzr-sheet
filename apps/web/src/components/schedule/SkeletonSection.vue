<script setup lang="ts">
import { computed, ref } from 'vue'

import { type MeetRoom, type MeetSlot } from '../../api'
import { bySortOrder, formatSlotTime, isStatsBreak, STATS_BREAK_LABEL } from '../../scheduleGrid'
import TimePickerButton from './TimePickerButton.vue'

interface PickerTime {
  hours: number
  minutes: number
  seconds?: number
}

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
  sortOrder?: number
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

/** Combine the date portion of `iso` with `HH:mm` into a new ISO string. */
function withTimeOfDay(iso: string, hhmm: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  d.setHours(h!, m!, 0, 0)
  return d.toISOString()
}

/** Current hour/minute of the day anchor, in the shape TimePickerButton
 *  expects. */
function anchorTimeModel(iso: string): PickerTime {
  const d = new Date(iso)
  return { hours: d.getHours(), minutes: d.getMinutes() }
}

/** When the day-anchor moves, shift every slot in that day by the same
 *  delta so each slot's relative position in the chain stays stable. */
function onAnchorPickerChange(group: DayGroup, value: PickerTime | null) {
  if (!value) return
  const pad = (n: number) => String(n).padStart(2, '0')
  const hhmm = `${pad(value.hours)}:${pad(value.minutes)}`
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

function addSlot(kind: 'quiz' | 'event', eventLabel: string | null = null) {
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
    eventLabel: kind === 'event' ? (eventLabel ?? '') : null,
    sortOrder,
  })
}

function addStatsBreak() {
  if (props.slots.some(isStatsBreak)) {
    alert('There is already a stats break. Move it instead of adding another.')
    return
  }
  addSlot('event', STATS_BREAK_LABEL)
}

const hasStatsBreak = computed(() => props.slots.some(isStatsBreak))

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

/** Active drag state for the grip handle. Reorder happens on pointerup;
 *  during drag we just track which row the cursor is over. Uses pointer
 *  events rather than HTML5 drag because the latter crashes on Linux/X11
 *  (see CLAUDE.md). */
const dragState = ref<{
  slotId: number
  groupKey: string
  fromIdx: number
  toIdx: number
} | null>(null)

/** Where the drop indicator line should land — null when no drag, or
 *  when the current target index is a no-op (already there). */
const dropIndicator = computed<{ idx: number; position: 'above' | 'below' } | null>(() => {
  const ds = dragState.value
  if (!ds) return null
  const insertIdx = ds.toIdx > ds.fromIdx ? ds.toIdx - 1 : ds.toIdx
  if (insertIdx === ds.fromIdx) return null
  const group = days.value.find((g) => g.dateKey === ds.groupKey)
  if (!group) return null
  if (ds.toIdx >= group.slots.length) {
    return { idx: group.slots.length - 1, position: 'below' }
  }
  return { idx: ds.toIdx, position: 'above' }
})

function startDrag(event: PointerEvent, group: DayGroup, slot: MeetSlot, idx: number) {
  if (!props.editable) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  dragState.value = {
    slotId: slot.id,
    groupKey: group.dateKey,
    fromIdx: idx,
    toIdx: idx,
  }
}

function onDragMove(event: PointerEvent) {
  if (!dragState.value) return
  const target = document.elementFromPoint(event.clientX, event.clientY)
  if (!target) return
  const tr = target.closest('tr[data-slot-id]') as HTMLElement | null
  if (!tr) return
  if (tr.dataset.groupKey !== dragState.value.groupKey) return
  const slotId = Number(tr.dataset.slotId)
  const group = days.value.find((g) => g.dateKey === dragState.value!.groupKey)
  if (!group) return
  const idx = group.slots.findIndex((s) => s.id === slotId)
  if (idx < 0) return
  // Insertion-point semantics: if cursor is in the top half of this
  // row, drop above it (toIdx = idx); bottom half, drop below
  // (toIdx = idx + 1). Lets the user drop after the last row too.
  const rect = tr.getBoundingClientRect()
  const inTopHalf = event.clientY < rect.top + rect.height / 2
  dragState.value.toIdx = inTopHalf ? idx : idx + 1
}

function endDrag(event: PointerEvent) {
  if (!dragState.value) return
  const el = event.currentTarget as HTMLElement
  if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
  const { groupKey, fromIdx, toIdx } = dragState.value
  dragState.value = null
  if (fromIdx === toIdx) return
  const group = days.value.find((g) => g.dateKey === groupKey)
  if (!group) return
  reorderWithinDay(group, fromIdx, toIdx)
}

/** Insertion-style reorder: move slot from `fromIdx` to insert before
 *  `toIdx` (where toIdx ranges 0..length, length = past the end).
 *  Then recompute each slot's startAt (cumulative from the day's
 *  first slot using each slot's own duration) and sortOrder. */
function reorderWithinDay(group: DayGroup, fromIdx: number, toIdx: number) {
  // Removing fromIdx first shifts every later index down by one, so the
  // post-removal insertion target is one less when we're moving down.
  const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
  if (insertIdx === fromIdx) return
  const newOrder = [...group.slots]
  const [moved] = newOrder.splice(fromIdx, 1)
  if (!moved) return
  newOrder.splice(insertIdx, 0, moved)
  const sortOrders = group.slots.map((s) => s.sortOrder)
  const anchor = group.slots[0]?.startAt
  if (!anchor) return
  let cursor = new Date(anchor).getTime()
  for (let i = 0; i < newOrder.length; i++) {
    const s = newOrder[i]!
    const newStart = new Date(cursor).toISOString()
    const newSortOrder = sortOrders[i]!
    if (s.startAt !== newStart || s.sortOrder !== newSortOrder) {
      emit('update-slot', {
        slotId: s.id,
        patch: { startAt: newStart, sortOrder: newSortOrder },
      })
    }
    cursor += s.durationMinutes * 60_000
  }
}

/** Swap a slot with its neighbour in the same day. Each slot keeps its
 *  own duration — the duration "rides along" with the slot — so the
 *  end of the pair stays anchored where it was; only the boundary
 *  between the two moves. Both startAt and sortOrder swap so the
 *  display order in the sorted list also updates. */
function swapWithNeighbour(group: DayGroup, slot: MeetSlot, direction: 'up' | 'down') {
  const idx = group.slots.findIndex((s) => s.id === slot.id)
  if (idx < 0) return
  const otherIdx = direction === 'up' ? idx - 1 : idx + 1
  if (otherIdx < 0 || otherIdx >= group.slots.length) return
  const earlier = idx < otherIdx ? slot : group.slots[otherIdx]!
  const later = idx < otherIdx ? group.slots[otherIdx]! : slot
  const sharedStart = earlier.startAt
  const earlierNewStart = new Date(
    new Date(sharedStart).getTime() + later.durationMinutes * 60_000,
  ).toISOString()
  emit('update-slot', {
    slotId: later.id,
    patch: { startAt: sharedStart, sortOrder: earlier.sortOrder },
  })
  emit('update-slot', {
    slotId: earlier.id,
    patch: { startAt: earlierNewStart, sortOrder: later.sortOrder },
  })
}

function deleteSlot(slot: MeetSlot) {
  if (isStatsBreak(slot)) {
    if (
      !confirm(
        `The stats break separates prelims from elims. Populate won't run without one. Delete anyway?`,
      )
    ) {
      return
    }
  } else {
    const label =
      slot.kind === 'event'
        ? slot.eventLabel || 'this event'
        : `the ${formatSlotTime(slot.startAt)} round`
    if (!confirm(`Delete ${label}?`)) return
  }
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
            <th class="dur-col" scope="col">Length</th>
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
            <td :colspan="contentColspan + 2" class="empty-row">No slots yet — add a day below.</td>
          </tr>
          <template v-for="group in days" :key="group.dateKey">
            <tr class="day-row">
              <th class="day-label" :colspan="contentColspan + 2" scope="colgroup">
                {{ group.label }}
              </th>
            </tr>
            <tr
              v-for="(slot, idx) in group.slots"
              :key="slot.id"
              :data-slot-id="slot.id"
              :data-group-key="group.dateKey"
              :class="{
                'event-row': slot.kind === 'event',
                'stats-break-row': isStatsBreak(slot),
                'is-dragging': dragState?.slotId === slot.id,
                'is-drop-above':
                  dropIndicator?.position === 'above' &&
                  dropIndicator.idx === idx &&
                  dragState?.groupKey === group.dateKey,
                'is-drop-below':
                  dropIndicator?.position === 'below' &&
                  dropIndicator.idx === idx &&
                  dragState?.groupKey === group.dateKey,
              }"
            >
              <th class="time-col" scope="row">
                <TimePickerButton
                  v-if="idx === 0 && editable"
                  :model-value="anchorTimeModel(slot.startAt)"
                  :title="`Change start time for ${group.label}`"
                  @update:model-value="onAnchorPickerChange(group, $event)"
                >
                  {{ formatSlotTime(slot.startAt) }}
                </TimePickerButton>
                <span v-else class="time-text">{{ formatSlotTime(slot.startAt) }}</span>
              </th>
              <td class="dur-col">
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
              </td>
              <td class="slot-cell" :colspan="contentColspan">
                <div class="slot-inner">
                  <span v-if="slot.kind === 'quiz'" class="slot-label">
                    Round {{ roundNumbers.get(slot.id) }}
                  </span>
                  <span v-else-if="isStatsBreak(slot)" class="slot-label slot-label--stats-break">
                    {{ STATS_BREAK_LABEL }}
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

                  <span v-if="editable" class="row-controls no-print">
                    <button
                      type="button"
                      class="row-grip"
                      title="Drag to reorder"
                      @pointerdown="startDrag($event, group, slot, idx)"
                      @pointermove="onDragMove"
                      @pointerup="endDrag"
                      @pointercancel="endDrag"
                    >
                      ⋮⋮
                    </button>
                    <button
                      type="button"
                      class="row-arrow"
                      :disabled="idx === 0"
                      title="Move slot up"
                      @click="swapWithNeighbour(group, slot, 'up')"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="row-arrow"
                      :disabled="idx === group.slots.length - 1"
                      title="Move slot down"
                      @click="swapWithNeighbour(group, slot, 'down')"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      class="row-delete"
                      title="Delete slot"
                      @click="deleteSlot(slot)"
                    >
                      ×
                    </button>
                  </span>
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
      <button
        type="button"
        class="add-btn"
        :disabled="days.length === 0 || hasStatsBreak"
        :title="hasStatsBreak ? 'Already in the schedule' : 'Required before populate'"
        @click="addStatsBreak"
      >
        + Stats break
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

/* No padding/text-align on the parent rule — per-column class rules
   below would lose the cascade ((0,1,0) vs (0,1,1)) and silently do
   nothing. Each column class sets its own. */
.schedule-table th,
.schedule-table td {
  border-bottom: 1px solid var(--color-border-alt);
  vertical-align: middle;
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
  padding: 0.5rem 0.875rem;
  text-align: center;
}

.time-col {
  width: 7rem;
  font-variant-numeric: tabular-nums;
  background: var(--color-bg);
  padding: 0.55rem 0.875rem;
  font-weight: 500;
  text-align: center;
}

thead .time-col {
  background: var(--color-bg-raised);
}

.time-text {
  color: var(--color-text);
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

.stats-break-row .slot-cell {
  background: var(--color-bg-raised);
  border-top: 2px solid var(--color-accent);
  border-bottom: 2px solid var(--color-accent);
}

.slot-label--stats-break {
  color: var(--color-accent);
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
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

.dur-col {
  width: 4.5rem;
  background: var(--color-bg);
  padding: 0.55rem 0.875rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

thead .dur-col {
  background: var(--color-bg-raised);
}

.slot-duration {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.2rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.dur-label {
  color: var(--color-text-faint);
  font-size: 0.72rem;
}

.row-controls {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}

.row-grip {
  background: none;
  border: 0;
  font: inherit;
  font-size: 0.85rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: grab;
  padding: 0.15rem 0.3rem;
  border-radius: 4px;
  letter-spacing: -0.15em;
  touch-action: none;
}

.row-grip:hover {
  color: var(--color-text-muted);
  background: var(--color-bg);
}

.row-grip:active {
  cursor: grabbing;
}

.is-dragging {
  opacity: 0.45;
}

/* Drop indicator: a 2px accent line at the top or bottom of the row,
   spanning all cells (time + length + slot). Inset box-shadow so it
   doesn't change the row height. */
.is-drop-above > th,
.is-drop-above > td {
  box-shadow: inset 0 2px 0 0 var(--color-accent);
}

.is-drop-below > th,
.is-drop-below > td {
  box-shadow: inset 0 -2px 0 0 var(--color-accent);
}

.row-arrow {
  background: none;
  border: 0;
  font: inherit;
  font-size: 0.85rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
}

.row-arrow:hover:not(:disabled) {
  color: var(--color-accent);
  background: var(--color-bg);
}

.row-arrow:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.empty-row {
  text-align: center;
  color: var(--color-text-faint);
  font-size: 0.85rem;
  padding: 1.25rem 0.6rem;
  background: var(--color-bg);
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
