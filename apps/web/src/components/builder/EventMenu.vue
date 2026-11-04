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
  <BuilderPopover :anchor="anchor" :title="event.label" tag="Event" @close="emit('close')">
    <label class="row">
      Name
      <input :value="event.label" aria-label="Event name" @change="rename" />
    </label>
    <div class="group">
      <h4 class="card-title">Rooms</h4>
      <div class="rooms">
        <button
          type="button"
          class="chip"
          :aria-pressed="event.rooms === 'all'"
          aria-label="All rooms"
          @click="setAll(event.rooms !== 'all')"
        >
          All
        </button>
        <button
          v-for="r in doc.rooms"
          :key="r.id"
          type="button"
          class="chip"
          :aria-pressed="takes(r.id)"
          :aria-label="`In ${r.name}`"
          @click="toggle(r.id, !takes(r.id))"
        >
          {{ r.name }}
        </button>
      </div>
    </div>
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
    </div>
    <div class="foot">
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
.rooms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

/* A room the event takes is marked as a segmented toggle's choice is */
.popover .chip {
  border-color: var(--color-border-alt);
  background: transparent;
}

.popover .chip[aria-pressed='true'] {
  border-color: var(--color-meta-accent);
  background: var(--color-bg);
  color: var(--color-heading);
}
</style>
