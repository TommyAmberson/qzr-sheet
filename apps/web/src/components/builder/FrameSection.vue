<script setup lang="ts">
import NumberInput from './NumberInput.vue'
import { computed } from 'vue'
import { addDay, deleteDay, editRow } from '../../builder/edits'
import { type ScheduleDocument, type ScheduleSettings, type UnappliedSetting } from '@qzr/shared'

const props = defineProps<{ doc: ScheduleDocument; unapplied: UnappliedSetting[] }>()
const emit = defineEmits<{
  change: [mutate: (d: ScheduleDocument) => void]
  /** A hand edit to the frame, which applies at once like an edit on the grid */
  edit: [mutate: (d: ScheduleDocument) => void]
}>()

const s = computed(() => props.doc.settings)
const was = (key: string) => props.unapplied.find((u) => u.key === key)?.applied

function set(mutate: (settings: ScheduleSettings) => void) {
  emit('change', (d) => mutate(d.settings))
}
const days = computed(() => props.doc.frame.filter((r) => r.kind === 'day'))
function rename(id: string, e: Event) {
  const label = (e.target as HTMLInputElement).value.trim()
  if (label) emit('edit', (d) => editRow(d, id, { label }))
}
const num = (e: Event) => Math.floor(Number((e.target as HTMLInputElement).value))
</script>

<template>
  <div class="frame-section">
    <label class="field">
      Slot length (min)
      <NumberInput
        min="1"
        :value="s.slotMinutes"
        aria-label="Slot length"
        @change="set((x) => (x.slotMinutes = Math.max(1, num($event))))"
      />
    </label>
    <p v-if="was('slotMinutes')" class="unapplied">
      Unapplied · grid uses {{ was('slotMinutes') }}
    </p>

    <label class="field">
      Rooms
      <NumberInput
        min="1"
        :value="s.rooms === 'auto' ? doc.rooms.length : s.rooms"
        :disabled="s.rooms === 'auto'"
        aria-label="Room count"
        @change="set((x) => (x.rooms = Math.max(1, num($event))))"
      />
    </label>
    <label class="check">
      <input
        type="checkbox"
        :checked="s.rooms === 'auto'"
        aria-label="As many rooms as needed"
        @change="
          set(
            (x) =>
              (x.rooms = ($event.target as HTMLInputElement).checked ? 'auto' : doc.rooms.length),
          )
        "
      />
      As many as needed
    </label>
    <p v-if="was('rooms')" class="unapplied">Unapplied · grid uses {{ was('rooms') }}</p>

    <h4>Days</h4>
    <ul class="days">
      <li v-for="day in days" :key="day.id">
        <input :value="day.label" aria-label="Day name" @change="rename(day.id, $event)" />
        <button
          type="button"
          class="icon"
          :aria-label="`Delete ${day.label}`"
          title="Delete the day; its quizzes go to Unplaced"
          :disabled="days.length <= 1"
          @click="emit('edit', (d) => deleteDay(d, day.id))"
        >
          ✕
        </button>
      </li>
    </ul>
    <button type="button" class="link" @click="emit('edit', (d) => addDay(d))">+ Add a day</button>
    <p class="hint">Add a day's events and slots from its heading on the grid.</p>
  </div>
</template>

<style scoped>
.frame-section {
  display: grid;
  gap: 0.5rem;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.field input {
  width: 5rem;
}

.days {
  display: grid;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.days li {
  display: flex;
  gap: 0.4rem;
}

.days input {
  flex: 1;
}

.frame-section .icon {
  padding: 0 0.45rem;
  border: 0;
  background: none;
}

.frame-section .icon:hover:not(:disabled) {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}

.frame-section > .link {
  justify-self: start;
}

.hint {
  margin: 0;
}

.unapplied {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-warn, #a60);
}
</style>
