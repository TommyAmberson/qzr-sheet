<script setup lang="ts">
import { computed } from 'vue'
import {
  formatClock,
  statsBreaks,
  type ScheduleDocument,
  type ScheduleSettings,
  type UnappliedSetting,
} from '@qzr/shared'

const props = defineProps<{ doc: ScheduleDocument; unapplied: UnappliedSetting[] }>()
const emit = defineEmits<{ change: [mutate: (d: ScheduleDocument) => void] }>()

const s = computed(() => props.doc.settings)
const was = (key: string) => props.unapplied.find((u) => u.key === key)?.applied

function set(mutate: (settings: ScheduleSettings) => void) {
  emit('change', (d) => mutate(d.settings))
}
const num = (e: Event) => Math.floor(Number((e.target as HTMLInputElement).value))

/** The Finals in the order they run, with the key the order setting uses */
const finals = computed(() => {
  const slotOrder = new Map(props.doc.frame.map((r, i) => [r.id, i]))
  return props.doc.quizzes
    .filter((q) => q.deciding && q.label.endsWith('Finals'))
    .sort(
      (a, b) =>
        (slotOrder.get(a.cell?.slot ?? '') ?? 1e9) - (slotOrder.get(b.cell?.slot ?? '') ?? 1e9),
    )
    .map((q) => ({ key: `${q.division}:${q.lane ?? 0}`, label: q.label }))
})

/** Move a Finals earlier or later; the whole order becomes the director's (FR-019a) */
function moveFinals(index: number, by: -1 | 1) {
  const keys = finals.value.map((f) => f.key)
  const to = index + by
  if (to < 0 || to >= keys.length) return
  ;[keys[index], keys[to]] = [keys[to]!, keys[index]!]
  set((x) => (x.finals.order = keys))
}

const breaks = computed(() => statsBreaks(props.doc))
</script>

<template>
  <div class="frame-section">
    <label class="field">
      Frame
      <select
        :value="s.framePreset"
        aria-label="Frame preset"
        @change="
          set(
            (x) =>
              (x.framePreset = ($event.target as HTMLSelectElement)
                .value as ScheduleSettings['framePreset']),
          )
        "
      >
        <option value="weekend">Weekend</option>
        <option value="oneDay">One day</option>
        <option value="oneRoom">One room</option>
      </select>
    </label>
    <p v-if="was('framePreset')" class="unapplied">
      Unapplied · grid uses {{ was('framePreset') }}
    </p>

    <label class="field">
      Slot length (min)
      <input
        type="number"
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
      <input
        type="number"
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

    <h4>Stats breaks</h4>
    <ul class="breaks">
      <li v-for="b in breaks" :key="b.division">
        {{ b.division }}: {{ formatClock(b.from) }} to {{ formatClock(b.to) }}
      </li>
    </ul>

    <h4>Finals</h4>
    <ol class="finals">
      <li v-for="(f, i) in finals" :key="f.key">
        {{ f.label }}
        <button type="button" :aria-label="`Move ${f.label} earlier`" @click="moveFinals(i, -1)">
          ▲
        </button>
        <button type="button" :aria-label="`Move ${f.label} later`" @click="moveFinals(i, 1)">
          ▼
        </button>
      </li>
    </ol>
    <label class="field">
      Minutes apart
      <input
        type="number"
        min="0"
        :value="s.finals.spacingMinutes"
        aria-label="Minutes between Finals"
        @change="set((x) => (x.finals.spacingMinutes = Math.max(0, num($event))))"
      />
    </label>
    <label class="field">
      At once
      <input
        type="number"
        min="1"
        :value="s.finals.sideBySide"
        aria-label="Finals at once"
        @change="set((x) => (x.finals.sideBySide = Math.max(1, num($event))))"
      />
    </label>
    <p v-if="was('finals')" class="unapplied">Unapplied</p>
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

h4 {
  margin: 0.5rem 0 0;
}

.unapplied {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-warn, #a60);
}

.finals button {
  font: inherit;
  background: none;
  border: none;
  cursor: pointer;
}
</style>
