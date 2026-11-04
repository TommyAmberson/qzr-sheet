<script setup lang="ts">
import NumberInput from './NumberInput.vue'
import { ref } from 'vue'
import {
  DIVISION_COLOURS,
  defaultElims,
  divisionColour,
  setTeamCount,
  type DivisionColour,
  type ScheduleDocument,
} from '@qzr/shared'

import { pinWhere } from '../../builder/edits'

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

/** The division whose colour is being picked, if any */
const picking = ref<string | null>(null)

function setColour(id: string, colour: DivisionColour) {
  emit('change', (d) => {
    const division = d.settings.divisions.find((x) => x.id === id)
    if (division) division.colour = colour
  })
  picking.value = null
}

/** How many of a division's teams have a name typed */
const namedIn = (id: string) => props.doc.draw[id]?.teams.filter((t) => t.name).length ?? 0

/** How many of a division's quizzes are pinned; unpinning them hands the division back (FR-011) */
const pinnedIn = (id: string) =>
  props.doc.quizzes.filter((q) => q.division === id && q.pinned).length

/** A division's team count; its elims follow its size until the director changes them (FR-030) */
function setTeams(id: string, event: Event) {
  const teams = Math.max(0, Math.floor(Number((event.target as HTMLInputElement).value)))
  if (!Number.isFinite(teams)) return
  emit('change', (d) => setTeamCount(d, id, teams))
}

/** A team's name, typed when standalone (FR-021); the draw's list grows with it */
function setTeamName(id: string, index: number, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  emit('change', (d) => {
    const draw = (d.draw[id] ??= { teams: [], stale: false })
    while (draw.teams.length <= index) draw.teams.push({ late: false, absent: false })
    draw.teams[index]!.name = name || undefined
  })
}
</script>

<template>
  <div class="teams">
    <label class="field">
      Divisions
      <NumberInput
        min="0"
        :value="doc.settings.divisions.length"
        aria-label="Number of divisions"
        @change="setCount"
      />
    </label>
    <div
      v-for="d in doc.settings.divisions"
      :key="d.id"
      class="division"
      :data-division="d.id"
      :style="{ '--qc': `var(--dc-${divisionColour(doc, d.id)})` }"
    >
      <div class="head">
        <button
          type="button"
          class="swatch"
          :aria-label="`${d.name} colour`"
          :aria-expanded="picking === d.id"
          title="Colour"
          @click="picking = picking === d.id ? null : d.id"
        />
        <input
          class="name"
          :value="d.name"
          aria-label="Division name"
          @change="setName(d.id, $event)"
        />
        <NumberInput
          min="0"
          :value="d.teams"
          :aria-label="`${d.name} team count`"
          @change="setTeams(d.id, $event)"
        />
        <span class="unit">teams</span>
      </div>
      <div v-if="picking === d.id" class="swatches" role="group" :aria-label="`${d.name} colours`">
        <button
          v-for="c in DIVISION_COLOURS"
          :key="c"
          type="button"
          class="swatch"
          :style="{ '--qc': `var(--dc-${c})` }"
          :aria-label="c"
          :aria-pressed="divisionColour(doc, d.id) === c"
          @click="setColour(d.id, c)"
        />
      </div>
      <div class="foot">
        <details v-if="d.teams > 0" class="names">
          <summary>
            Team names <span class="hint">{{ namedIn(d.id) }} of {{ d.teams }}</span>
          </summary>
          <ol>
            <li v-for="i in d.teams" :key="i">
              <input
                :value="doc.draw[d.id]?.teams[i - 1]?.name ?? ''"
                :placeholder="`Team ${i}`"
                :aria-label="`${d.name} team ${i} name`"
                @change="setTeamName(d.id, i - 1, $event)"
              />
            </li>
          </ol>
        </details>
        <button
          v-if="pinnedIn(d.id) > 0"
          type="button"
          class="link unpin"
          @click="emit('change', (x) => pinWhere(x, (q) => q.division === d.id, false))"
        >
          Unpin {{ d.name }} ({{ pinnedIn(d.id) }})
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.teams {
  display: grid;
  gap: 0.6rem;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

/* Each division a card edged in the colour its quizzes carry on the grid */
.division {
  display: grid;
  min-width: 0;
  gap: 0.35rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border-alt);
  border-left: 3px solid var(--qc);
  border-radius: 6px;
  background: var(--color-bg);
}

.head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.teams .name {
  flex: 1;
  width: 0;
  min-width: 0;
  border-color: transparent;
  background: transparent;
  color: var(--color-heading);
  font-weight: 650;
}

.teams .name:hover {
  border-color: var(--color-meta-accent);
}

.unit {
  color: var(--color-text-faint);
  font-size: 0.75rem;
}

.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 0.75rem;
  font-size: 0.8rem;
}

.names {
  flex: 1;
}

.names summary {
  color: var(--color-text-muted);
  cursor: pointer;
}

.names ol {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem;
  margin: 0.4rem 0 0;
  padding: 0;
  list-style: none;
}

.names input {
  width: 100%;
  font-size: 0.8rem;
}

.unpin {
  font-size: 0.8rem;
}
/* A division's colour, a dot that opens the choice of them */
.teams .swatch {
  flex: none;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 2px solid var(--color-bg);
  border-radius: 50%;
  background: var(--qc);
  box-shadow: 0 0 0 1px var(--color-border-alt);
}

.teams .swatch[aria-pressed='true'],
.teams .swatch[aria-expanded='true'] {
  box-shadow: 0 0 0 2px var(--color-heading);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.2rem 0 0.1rem 0.15rem;
}
</style>
