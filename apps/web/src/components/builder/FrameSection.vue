<script setup lang="ts">
import NumberInput from './NumberInput.vue'
import { computed } from 'vue'
import { type ScheduleDocument, type ScheduleSettings, type UnappliedSetting } from '@qzr/shared'

const props = defineProps<{ doc: ScheduleDocument; unapplied: UnappliedSetting[] }>()
const emit = defineEmits<{ change: [mutate: (d: ScheduleDocument) => void] }>()

const s = computed(() => props.doc.settings)
const was = (key: string) => props.unapplied.find((u) => u.key === key)?.applied

function set(mutate: (settings: ScheduleSettings) => void) {
  emit('change', (d) => mutate(d.settings))
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

.unapplied {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-warn, #a60);
}
</style>
