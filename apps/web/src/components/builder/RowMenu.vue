<script setup lang="ts">
import NumberInput from './NumberInput.vue'
import { computed } from 'vue'
import { formatClock, type FrameRow, type ScheduleDocument } from '@qzr/shared'

import {
  deleteDay,
  deleteRow,
  editRow,
  insertDay,
  insertEvent,
  insertRow,
  pinWhere,
} from '../../builder/edits'
import { followRows } from '../../builder/followRows'
import BuilderPopover from './BuilderPopover.vue'

/**
 * A row's menu: retime it, set its length, rename a day or a note, delete it, or insert a slot, a
 * slot holding an event across every room, or a note after it (FR-016, FR-017). Rows never
 * overlap; with "Later rows follow" on, the rows after move with this one's end, and otherwise only
 * as far as they must. The events in a row have menus of their own.
 */
const props = defineProps<{ doc: ScheduleDocument; rowId: string; anchor: HTMLElement }>()
const emit = defineEmits<{
  change: [mutate: (d: ScheduleDocument) => void]
  /** A change the generator follows, as a settings change (unpinning) */
  settings: [mutate: (d: ScheduleDocument) => void]
  close: []
}>()

const row = computed(() => props.doc.frame.find((r) => r.id === props.rowId)!)

// A slot's row of quizzes pins or unpins together (FR-011)
const inRow = computed(() => props.doc.quizzes.filter((q) => q.cell?.slot === props.rowId))
const pinnedCount = computed(() => inRow.value.filter((q) => q.pinned).length)
function pinRow(pinned: boolean) {
  const pick = (q: ScheduleDocument['quizzes'][number]) => q.cell?.slot === props.rowId
  const mutate = (d: ScheduleDocument) => pinWhere(d, pick, pinned)
  // Pinning changes nothing on the grid; unpinning hands quizzes back to the generator
  if (pinned) emit('change', mutate)
  else emit('settings', mutate)
  emit('close')
}
const title = computed(() => {
  const r = row.value
  if (r.kind === 'slot') return formatClock(r.at)
  return r.kind === 'note' ? 'Note' : r.label
})
const tag = computed(() => {
  const r = row.value
  if (r.kind === 'slot') return r.use === 'event' ? 'Event row' : 'Slot'
  return r.kind === 'day' ? 'Day' : ''
})

const toClock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromClock = (v: string) => {
  const [h, m] = v.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function patch(p: Partial<FrameRow>) {
  const follow = followRows.value
  emit('change', (d) => editRow(d, props.rowId, p, follow))
}

function remove() {
  const follow = followRows.value
  emit('change', (d) => deleteRow(d, props.rowId, follow))
  emit('close')
}

/** The first time on a day, for a row inserted at its start: an hour before its first, or 9:00 */
function dayStart(id: string) {
  const frame = props.doc.frame
  for (let i = frame.findIndex((r) => r.id === id) + 1; i < frame.length; i++) {
    const r = frame[i]!
    if (r.kind === 'day') break
    if (r.kind === 'slot') return Math.max(0, r.at - 60)
  }
  return 9 * 60
}

/** A new row starts where this one ends, or, after a day's heading, early in the day */
function insert(kind: 'slot' | 'event' | 'note') {
  const r = row.value
  const at = r.kind === 'slot' ? r.at + r.minutes : dayStart(r.id)
  // A slot after a quiz slot is as long; one after an event row is a quiz's length
  const minutes =
    r.kind === 'slot' && r.use !== 'event' ? r.minutes : props.doc.settings.slotMinutes
  const id = crypto.randomUUID()
  const follow = followRows.value
  if (kind === 'event') emit('change', (d) => insertEvent(d, props.rowId, { at, minutes }, follow))
  else {
    const next: FrameRow =
      kind === 'slot' ? { kind: 'slot', id, at, minutes } : { kind: 'note', id, text: 'Note' }
    emit('change', (d) => insertRow(d, props.rowId, next, follow))
  }
  emit('close')
}
</script>

<template>
  <BuilderPopover :anchor="anchor" :title="title" :tag="tag" @close="emit('close')">
    <template v-if="row.kind === 'slot'">
      <label class="row">
        Starts
        <input
          type="time"
          :value="toClock(row.at)"
          aria-label="Start time"
          @change="patch({ at: fromClock(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <label class="row">
        Minutes
        <NumberInput
          min="1"
          :value="row.minutes"
          aria-label="Length"
          @change="
            patch({
              minutes: Math.max(
                1,
                Math.round(Number(($event.target as HTMLInputElement).value)) || 1,
              ),
            })
          "
        />
      </label>
    </template>
    <label v-if="row.kind !== 'note'" class="follow">
      <input v-model="followRows" type="checkbox" aria-label="Later rows follow" />
      Later rows follow
    </label>
    <label v-if="row.kind === 'day'" class="row">
      Name
      <input
        :value="row.label"
        aria-label="Row name"
        @change="patch({ label: ($event.target as HTMLInputElement).value })"
      />
    </label>
    <label v-if="row.kind === 'note'" class="row">
      Text
      <input
        :value="row.text"
        aria-label="Note text"
        @change="patch({ text: ($event.target as HTMLInputElement).value })"
      />
    </label>
    <div v-if="row.kind === 'slot' && inRow.length > 0" class="actions">
      <button type="button" :disabled="pinnedCount === inRow.length" @click="pinRow(true)">
        Pin row
      </button>
      <button type="button" :disabled="pinnedCount === 0" @click="pinRow(false)">
        Unpin row ({{ pinnedCount }})
      </button>
    </div>
    <div class="group">
      <h4 class="card-title">{{ row.kind === 'day' ? 'Insert first' : 'Insert after' }}</h4>
      <div class="actions">
        <button type="button" aria-label="Insert slot after" @click="insert('slot')">Slot</button>
        <button type="button" aria-label="Insert event after" @click="insert('event')">
          Event
        </button>
        <button type="button" aria-label="Insert note after" @click="insert('note')">Note</button>
        <button
          v-if="row.kind === 'day'"
          type="button"
          aria-label="Insert day after"
          @click="(emit('change', (d) => insertDay(d, rowId)), emit('close'))"
        >
          Day after
        </button>
      </div>
    </div>
    <div class="foot">
      <button
        v-if="row.kind === 'day'"
        type="button"
        class="danger"
        @click="(emit('change', (d) => deleteDay(d, rowId)), emit('close'))"
      >
        Delete day
      </button>
      <button v-else type="button" class="danger" @click="remove">Delete</button>
    </div>
  </BuilderPopover>
</template>

<style scoped>
.follow {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--color-text-faint);
  font-size: 0.85rem;
}
</style>
