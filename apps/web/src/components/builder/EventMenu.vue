<script setup lang="ts">
import { computed } from 'vue'
import type { ScheduleDocument } from '@qzr/shared'

import { deleteEvent, editEvent, eventToQuiz, moveEvent, setEventPinned } from '../../builder/edits'
import BuilderPopover from './BuilderPopover.vue'

/**
 * An event's menu on the grid, as a quiz's: rename it, choose its rooms or all of them, move it,
 * move it to the unplaced tray, pin or unpin, delete it, or turn it into a quiz (FR-017).
 */
const props = defineProps<{ doc: ScheduleDocument; eventId: string; anchor: HTMLElement }>()
const emit = defineEmits<{
  change: [mutate: (d: ScheduleDocument) => void]
  close: []
  /** Start moving this event: the next cell chosen is where it goes */
  move: [id: string]
  /** It became a quiz, whose menu opens in its place */
  quiz: [id: string]
}>()

const event = computed(() => props.doc.events.find((e) => e.id === props.eventId)!)
const exists = computed(() => props.doc.events.some((e) => e.id === props.eventId))
const takes = (room: string) => event.value.rooms === 'all' || event.value.rooms.includes(room)

function rename(e: Event) {
  const label = (e.target as HTMLInputElement).value.trim()
  if (label && label !== event.value.label) {
    emit('change', (d) => editEvent(d, props.eventId, { label }))
  }
}

function setAll(all: boolean) {
  const rooms = all ? 'all' : props.doc.rooms.map((r) => r.id)
  emit('change', (d) => editEvent(d, props.eventId, { rooms }))
}

/** Rooms ticked one by one; ticking the last of them is all rooms, which follows the room count */
function toggle(room: string, on: boolean) {
  const now = props.doc.rooms.map((r) => r.id).filter((r) => (r === room ? on : takes(r)))
  if (now.length === 0) return
  const rooms = now.length === props.doc.rooms.length ? 'all' : now
  emit('change', (d) => editEvent(d, props.eventId, { rooms }))
}

function toQuiz() {
  let id = ''
  emit('change', (d) => (id = eventToQuiz(d, props.eventId)))
  emit('quiz', id)
}
</script>

<template>
  <!-- Gone once turned into a quiz, until its menu opens in this one's place -->
  <BuilderPopover v-if="exists" :anchor="anchor" :title="event.label" @close="emit('close')">
    <label class="field">
      Name
      <input :value="event.label" aria-label="Event name" @change="rename" />
    </label>
    <fieldset class="rooms">
      <legend>Rooms</legend>
      <label class="check all">
        <input
          type="checkbox"
          :checked="event.rooms === 'all'"
          aria-label="All rooms"
          @change="setAll(($event.target as HTMLInputElement).checked)"
        />
        All rooms
      </label>
      <label v-for="r in doc.rooms" :key="r.id" class="check">
        <input
          type="checkbox"
          :checked="takes(r.id)"
          :aria-label="`In ${r.name}`"
          @change="toggle(r.id, ($event.target as HTMLInputElement).checked)"
        />
        {{ r.name }}
      </label>
    </fieldset>
    <div class="actions">
      <button type="button" @click="emit('move', eventId)">Move</button>
      <button
        type="button"
        :disabled="!event.slot"
        @click="emit('change', (d) => moveEvent(d, eventId, null))"
      >
        Move to Unplaced
      </button>
      <button
        type="button"
        @click="emit('change', (d) => setEventPinned(d, eventId, !event.pinned))"
      >
        {{ event.pinned ? 'Unpin' : 'Pin' }}
      </button>
      <button type="button" @click="toQuiz">Turn into quiz</button>
      <button
        type="button"
        class="danger"
        @click="(emit('change', (d) => deleteEvent(d, eventId)), emit('close'))"
      >
        Delete
      </button>
    </div>
  </BuilderPopover>
</template>

<style scoped>
.field {
  display: grid;
  gap: 0.25rem;
}

.rooms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  margin: 0;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
}

.rooms legend {
  padding: 0 0.25rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
}

.check.all {
  flex-basis: 100%;
  font-weight: 600;
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
