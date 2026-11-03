<script setup lang="ts">
import { computed } from 'vue'
import { formatClock, type FrameRow, type ScheduleDocument } from '@qzr/shared'

import { deleteRow, editRow, insertRow } from '../../builder/edits'
import BuilderPopover from './BuilderPopover.vue'

/**
 * A row's menu: retime it, set its length, rename an event or a note, delete it, or insert a slot,
 * an event (in every room or one) or a note after it (FR-016, FR-017). Later times stay as they
 * are.
 */
const props = defineProps<{ doc: ScheduleDocument; rowId: string; anchor: HTMLElement }>()
const emit = defineEmits<{ change: [mutate: (d: ScheduleDocument) => void]; close: [] }>()

const row = computed(() => props.doc.frame.find((r) => r.id === props.rowId)!)
const title = computed(() => {
  const r = row.value
  if (r.kind === 'slot') return `Slot at ${formatClock(r.at)}`
  if (r.kind === 'event') return r.label
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

/** A new row starts where this one ends */
function insert(kind: 'slot' | 'event' | 'note', room?: string) {
  const r = row.value
  const at = r.kind === 'slot' || r.kind === 'event' ? r.at + r.minutes : 0
  const minutes = r.kind === 'slot' ? r.minutes : props.doc.settings.slotMinutes
  const id = crypto.randomUUID()
  const next: FrameRow =
    kind === 'slot'
      ? { kind: 'slot', id, at, minutes }
      : kind === 'event'
        ? { kind: 'event', id, at, minutes, label: 'Event', ...(room ? { room } : {}) }
        : { kind: 'note', id, text: 'Note' }
  emit('change', (d) => insertRow(d, props.rowId, next))
  emit('close')
}
</script>

<template>
  <BuilderPopover :anchor="anchor" :title="title" @close="emit('close')">
    <template v-if="row.kind === 'slot' || row.kind === 'event'">
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
        <input
          type="number"
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
    <label v-if="row.kind === 'event' || row.kind === 'day'" class="field">
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
    <label v-if="row.kind === 'event'" class="field">
      Room
      <select
        :value="row.room ?? ''"
        aria-label="Event room"
        @change="patch({ room: ($event.target as HTMLSelectElement).value || undefined })"
      >
        <option value="">Every room</option>
        <option v-for="r in doc.rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
    </label>
    <div class="actions">
      <button type="button" @click="insert('slot')">Insert slot after</button>
      <button type="button" @click="insert('event')">Insert event after</button>
      <button type="button" @click="insert('note')">Insert note after</button>
      <button
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
