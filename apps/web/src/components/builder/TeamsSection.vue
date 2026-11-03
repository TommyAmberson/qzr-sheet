<script setup lang="ts">
import { defaultElims, type ScheduleDocument } from '@qzr/shared'

const props = defineProps<{ doc: ScheduleDocument }>()
const emit = defineEmits<{ change: [mutate: (d: ScheduleDocument) => void] }>()

/** The number of divisions (FR-021); a new one starts as `Div n` with no teams yet */
function setCount(event: Event) {
  const count = Math.max(0, Math.floor(Number((event.target as HTMLInputElement).value)))
  if (!Number.isFinite(count) || count === props.doc.settings.divisions.length) return
  emit('change', (d) => {
    const divisions = d.settings.divisions.slice(0, count)
    for (let n = divisions.length; n < count; n++) {
      divisions.push({
        id: crypto.randomUUID(),
        name: `Div ${n + 1}`,
        teams: 0,
        elims: defaultElims(0),
      })
    }
    d.settings.divisions = divisions
  })
}

function setName(id: string, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  if (!name) return
  emit('change', (d) => {
    const division = d.settings.divisions.find((x) => x.id === id)
    if (division) division.name = name
  })
}

/** A division's team count; its elims follow its size until the director changes them (FR-030) */
function setTeams(id: string, event: Event) {
  const teams = Math.max(0, Math.floor(Number((event.target as HTMLInputElement).value)))
  if (!Number.isFinite(teams)) return
  emit('change', (d) => {
    const division = d.settings.divisions.find((x) => x.id === id)
    if (!division || division.teams === teams) return
    division.teams = teams
    division.elims = defaultElims(teams)
  })
}
</script>

<template>
  <div class="teams">
    <label class="field">
      Divisions
      <input
        type="number"
        min="0"
        :value="doc.settings.divisions.length"
        aria-label="Number of divisions"
        @change="setCount"
      />
    </label>
    <div v-for="d in doc.settings.divisions" :key="d.id" class="division" :data-division="d.id">
      <input :value="d.name" aria-label="Division name" @change="setName(d.id, $event)" />
      <label class="field">
        Teams
        <input
          type="number"
          min="0"
          :value="d.teams"
          :aria-label="`${d.name} team count`"
          @change="setTeams(d.id, $event)"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.teams {
  display: grid;
  gap: 0.75rem;
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

.division {
  display: grid;
  gap: 0.25rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border, #ddd);
}
</style>
