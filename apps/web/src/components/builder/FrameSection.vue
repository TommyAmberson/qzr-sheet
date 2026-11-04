<script setup lang="ts">
import NumberInput from './NumberInput.vue'
import { computed } from 'vue'
import { addDay, deleteDay, editRow } from '../../builder/edits'
import {
  formatClock,
  recommendedRooms,
  type ScheduleDocument,
  type ScheduleSettings,
  type UnappliedSetting,
} from '@qzr/shared'

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
/** Each day with what it holds and when it starts and ends, from its heading to the next */
const days = computed(() => {
  const list: {
    id: string
    label: string
    slots: number
    events: number
    from: number | null
    to: number | null
  }[] = []
  for (const row of props.doc.frame) {
    if (row.kind === 'day') {
      list.push({ id: row.id, label: row.label, slots: 0, events: 0, from: null, to: null })
    }
    const day = list[list.length - 1]
    if (!day || row.kind !== 'slot') continue
    if (row.use !== 'event') day.slots++
    day.events += props.doc.events.filter((e) => e.slot === row.id).length
    day.from = Math.min(day.from ?? row.at, row.at)
    day.to = Math.max(day.to ?? 0, row.at + row.minutes)
  }
  return list
})

/** Quiz slots holding a quiz whose length isn't the default, with their day */
const offLength = computed(() => {
  const list: { id: string; when: string; minutes: number }[] = []
  let day = ''
  for (const row of props.doc.frame) {
    if (row.kind === 'day') day = row.label
    if (row.kind !== 'slot' || row.use === 'event' || row.minutes === s.value.slotMinutes) continue
    if (!props.doc.quizzes.some((q) => q.cell?.slot === row.id)) continue
    list.push({
      id: row.id,
      when: `${day.slice(0, 3)} ${formatClock(row.at)}`,
      minutes: row.minutes,
    })
  }
  return list
})

// Only what the recommendation depends on, so it's worked out again only when one of them
// changes, not on every edit (each edit brings a new document)
const roomInputs = computed(() => {
  const { framePreset, prelimDraw, quizzesPerTeam, divisions } = props.doc.settings
  return JSON.stringify({
    framePreset,
    prelimDraw,
    quizzesPerTeam,
    divisions: divisions.map((d) => ({ teams: d.teams })),
  })
})
const recommended = computed(() => recommendedRooms(JSON.parse(roomInputs.value)))
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
function rename(id: string, e: Event) {
  const label = (e.target as HTMLInputElement).value.trim()
  if (label) emit('edit', (d) => editRow(d, id, { label }))
}
const num = (e: Event) => Math.floor(Number((e.target as HTMLInputElement).value))
</script>

<template>
  <div class="frame-section">
    <section class="card">
      <h4 class="card-title">Slots</h4>
      <label class="field">
        Default length
        <span class="with-unit">
          <NumberInput
            min="1"
            :value="s.slotMinutes"
            aria-label="Slot length"
            @change="set((x) => (x.slotMinutes = Math.max(1, num($event))))"
          />
          <span class="unit">min</span>
        </span>
      </label>
      <p v-if="was('slotMinutes')" class="unapplied">
        Unapplied · grid uses {{ was('slotMinutes') }}
      </p>
      <!-- Slots set to their own length on the grid, where it matters: those holding a quiz -->
      <ul v-if="offLength.length > 0" class="off" aria-label="Slots of another length">
        <li v-for="o in offLength" :key="o.id">
          <span>{{ o.when }}</span>
          <span class="sum">{{ o.minutes }} min</span>
        </li>
      </ul>
    </section>

    <section class="card">
      <h4 class="card-title">Rooms</h4>
      <label class="field">
        Rooms
        <span class="with-unit">
          <NumberInput
            min="1"
            :value="s.rooms === 'auto' ? doc.rooms.length : s.rooms"
            aria-label="Room count"
            @change="set((x) => (x.rooms = Math.max(1, num($event))))"
          />
          <span class="unit">rooms</span>
        </span>
      </label>
      <!-- The rooms the prelims need; following it keeps the count in step as teams change -->
      <p class="recommend">
        <template v-if="s.rooms === 'auto'">Following the recommendation</template>
        <template v-else>
          Recommended: {{ recommended }}
          <button
            v-if="s.rooms !== recommended"
            type="button"
            class="link"
            aria-label="Use the recommended rooms"
            @click="set((x) => (x.rooms = 'auto'))"
          >
            Use {{ recommended }}
          </button>
        </template>
      </p>
      <p v-if="was('rooms')" class="unapplied">Unapplied · grid uses {{ was('rooms') }}</p>
    </section>

    <section class="card">
      <h4 class="card-title">Days</h4>
      <ul class="days">
        <li v-for="day in days" :key="day.id">
          <input
            class="name"
            :value="day.label"
            aria-label="Day name"
            @change="rename(day.id, $event)"
          />
          <span class="sum">
            <template v-if="day.from !== null"
              >{{ formatClock(day.from) }}–{{ formatClock(day.to!) }}<br
            /></template>
            {{ plural(day.slots, 'slot')
            }}<template v-if="day.events"> · {{ plural(day.events, 'event') }}</template>
          </span>
          <button
            type="button"
            class="icon"
            :aria-label="`Delete ${day.label}`"
            title="Delete the day; its quizzes and events go to Unplaced"
            :disabled="days.length <= 1"
            @click="emit('edit', (d) => deleteDay(d, day.id))"
          >
            ✕
          </button>
        </li>
      </ul>
      <div class="foot">
        <button type="button" class="link" @click="emit('edit', (d) => addDay(d))">
          + Add a day
        </button>
        <span class="hint">To add slots or events to a day, click its name on the grid</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.frame-section {
  display: grid;
  gap: 0.6rem;
}

.card-title {
  margin: 0;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.with-unit {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.sum {
  text-align: right;
  line-height: 1.3;
}

.unit,
.sum {
  color: var(--color-text-faint);
  font-size: 0.75rem;
}

.off {
  display: grid;
  margin: 0;
  padding: 0.3rem 0 0;
  border-top: 1px dashed var(--color-border-alt);
  list-style: none;
  font-size: 0.8rem;
}

.off li {
  display: flex;
  justify-content: space-between;
}

.recommend {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.5rem;
  margin: 0;
  color: var(--color-text-faint);
  font-size: 0.75rem;
}

.days {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.days li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0;
  border-top: 1px dashed var(--color-border-alt);
}

.days li:first-child {
  border-top: 0;
}

/* A day's name reads as its title until it's edited */
.frame-section .name {
  flex: 1;
  width: 0;
  min-width: 0;
  border-color: transparent;
  background: transparent;
  color: var(--color-heading);
  font-weight: 650;
}

.frame-section .name:hover {
  border-color: var(--color-meta-accent);
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

.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 0.75rem;
}

.foot .hint {
  font-size: 0.75rem;
}

.unapplied {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-warn, #a60);
}
</style>
