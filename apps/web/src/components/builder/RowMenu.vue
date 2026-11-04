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
import BuilderPopover from './BuilderPopover.vue'

/**
 * A row's menu: retime it, set its length, rename a day or a note, delete it, or insert a slot, a
 * slot holding an event across every room, or a note after it (FR-016, FR-017). Later times stay
 * as they are; the events in a row have menus of their own.
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
  if (r.kind === 'slot') return `${r.use === 'event' ? 'Row' : 'Slot'} at ${formatClock(r.at)}`
  return r.kind === 'note' ? 'Note' : r.label
})

const toClock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromClock = (v: string) => {
  const [h, m] = v.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function patch(p: Partial<FrameRow>) {
  emit('change', (d) => editRow(d, props.rowId, p))
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
  if (kind === 'event') emit('change', (d) => insertEvent(d, props.rowId, { at, minutes }))
  else {
    const next: FrameRow =
      kind === 'slot' ? { kind: 'slot', id, at, minutes } : { kind: 'note', id, text: 'Note' }
    emit('change', (d) => insertRow(d, props.rowId, next))
  }
  emit('close')
}
</script>

<template>
  <BuilderPopover :anchor="anchor" :title="title" @close="emit('close')">
    <template v-if="row.kind === 'slot'">
      <label class="field">
        Starts
        <input
          type="time"
          :value="toClock(row.at)"
          aria-label="Start time"
          @change="patch({ at: fromClock(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <label class="field">
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
    <label v-if="row.kind === 'day'" class="field">
      Name
      <input
        :value="row.label"
        aria-label="Row name"
        @change="patch({ label: ($event.target as HTMLInputElement).value })"
      />
    </label>
    <label v-if="row.kind === 'note'" class="field">
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
    <div class="actions">
      <button type="button" @click="insert('slot')">Insert slot after</button>
      <button type="button" @click="insert('event')">Insert event after</button>
      <button type="button" @click="insert('note')">Insert note after</button>
      <template v-if="row.kind === 'day'">
        <button type="button" @click="(emit('change', (d) => insertDay(d, rowId)), emit('close'))">
          Insert day after
        </button>
        <button
          type="button"
          class="danger"
          @click="(emit('change', (d) => deleteDay(d, rowId)), emit('close'))"
        >
          Delete day
        </button>
      </template>
      <button
        v-else
        type="button"
        class="danger"
        @click="(emit('change', (d) => deleteRow(d, rowId)), emit('close'))"
      >
        Delete
      </button>
    </div>
  </BuilderPopover>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.danger {
  color: var(--color-danger, #c33);
}
</style>
