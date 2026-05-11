<script setup lang="ts">
import { computed } from 'vue'

import {
  estimateLaneQuizzes,
  laneLabel,
  TOGGLEABLE_LANES,
  type ExtraLane,
  type LaneId,
} from '../../brackets'

const props = defineProps<{
  divisions: string[]
  teamCounts: Record<string, number>
  extraLanes: Record<string, ExtraLane[]>
  editable: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-lane', payload: { division: string; lane: LaneId }): void
  (e: 'resize-lane', payload: { division: string; lane: LaneId; teamCount: number }): void
}>()

interface RenderLane {
  id: LaneId
  label: string
  teamCount: number
  estimate: number
  removable: boolean
  resizable: boolean
}

interface DivisionRow {
  division: string
  teamCount: number
  lanes: RenderLane[]
  elimEstimate: number
  laneTotal: number
  oversubscribed: boolean
}

const rows = computed<DivisionRow[]>(() =>
  props.divisions.map((d) => {
    const teamCount = props.teamCounts[d] ?? 0
    const extras = props.extraLanes[d] ?? []
    const usedByExtras = extras.reduce((sum, l) => sum + l.teamCount, 0)
    const mainSize = Math.max(0, teamCount - usedByExtras)
    const lanes: RenderLane[] = [
      {
        id: 'main',
        label: laneLabel(d, 'main'),
        teamCount: mainSize,
        estimate: estimateLaneQuizzes(mainSize),
        removable: false,
        resizable: false,
      },
      ...extras.map((l) => ({
        id: l.id,
        label: laneLabel(d, l.id),
        teamCount: l.teamCount,
        estimate: estimateLaneQuizzes(l.teamCount),
        removable: true,
        resizable: true,
      })),
    ]
    return {
      division: d,
      teamCount,
      lanes,
      elimEstimate: lanes.reduce((sum, l) => sum + l.estimate, 0),
      laneTotal: lanes.reduce((sum, l) => sum + l.teamCount, 0),
      oversubscribed: usedByExtras > teamCount,
    }
  }),
)

const totalElim = computed(() => rows.value.reduce((sum, r) => sum + r.elimEstimate, 0))

function isEnabled(division: string, lane: LaneId): boolean {
  return (props.extraLanes[division] ?? []).some((l) => l.id === lane)
}

function onSizeInput(division: string, lane: LaneId, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return
  emit('resize-lane', { division, lane, teamCount: n })
}
</script>

<template>
  <section class="elim-setup">
    <header class="section-head">
      <h2 class="section-title">Elim setup</h2>
      <p class="section-meta">
        <span>~{{ totalElim }} elim quizzes</span>
        <span class="rule" aria-hidden="true">/</span>
        <span>{{ divisions.length }} divisions</span>
      </p>
      <span v-if="editable" class="draft-badge">Draft</span>
    </header>

    <ol class="divisions">
      <li v-for="row in rows" :key="row.division" class="division">
        <div class="division-head">
          <h3 class="division-name">Division {{ row.division }}</h3>
          <dl class="division-stats">
            <div class="stat">
              <dt>Teams</dt>
              <dd>{{ row.teamCount }}</dd>
            </div>
            <div class="stat">
              <dt>Elim&nbsp;est</dt>
              <dd>~{{ row.elimEstimate }}</dd>
            </div>
          </dl>
        </div>

        <div class="lanes">
          <div
            v-for="lane in row.lanes"
            :key="lane.id"
            class="lane"
            :class="{ 'lane--main': lane.id === 'main' }"
          >
            <span class="lane-name">{{ lane.label }}</span>
            <span class="lane-stat">
              <input
                v-if="lane.resizable && editable"
                class="lane-size-input"
                type="number"
                min="0"
                :value="lane.teamCount"
                aria-label="Team count"
                @input="onSizeInput(row.division, lane.id, $event)"
              />
              <span v-else class="lane-size">{{ lane.teamCount }}</span>
              <span class="lane-stat-label">teams</span>
            </span>
            <span class="lane-stat">
              <span class="lane-est">~{{ lane.estimate }}</span>
              <span class="lane-stat-label">elim</span>
            </span>
            <button
              v-if="lane.removable && editable"
              type="button"
              class="lane-remove"
              :title="`Remove ${lane.label}`"
              @click="emit('toggle-lane', { division: row.division, lane: lane.id })"
            >
              ×
            </button>
          </div>

          <button
            v-for="lane in TOGGLEABLE_LANES.filter((l) => !isEnabled(row.division, l))"
            :key="lane"
            type="button"
            class="lane-add"
            :disabled="!editable"
            @click="emit('toggle-lane', { division: row.division, lane })"
          >
            + {{ laneLabel(row.division, lane) }}
          </button>

          <p v-if="row.oversubscribed" class="lane-warning">
            Lanes hold {{ row.laneTotal }} teams; division has only {{ row.teamCount }}.
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.elim-setup {
  padding: 1.5rem 0 1rem;
  border-top: 2px solid var(--color-text);
  margin-top: 1.5rem;
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.section-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.55rem;
  margin: 0;
  letter-spacing: -0.015em;
  color: var(--color-heading);
  flex-shrink: 0;
}

.section-meta {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.5rem;
}

.rule {
  color: var(--color-border);
}

.draft-badge {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-bg);
  background: var(--color-text);
  padding: 0.15rem 0.45rem;
  margin-left: auto;
  align-self: center;
}

.divisions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.division {
  display: grid;
  grid-template-columns: minmax(0, 14rem) minmax(0, 1fr);
  gap: 1.5rem;
  padding: 1rem 0;
  border-top: 1px solid var(--color-border-alt);
}

.division:first-child {
  border-top-color: var(--color-border);
}

.division-head {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.division-name {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 1.4rem;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--color-text);
}

.division-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 0.85rem;
  margin: 0;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.stat dt {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
}

.stat dd {
  font-family: var(--font-mono);
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
  margin: 0;
  line-height: 1;
}

.lanes {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.lane {
  display: grid;
  grid-template-columns: minmax(0, 8rem) minmax(0, 6rem) minmax(0, 6rem) auto;
  align-items: baseline;
  gap: 0.5rem 1rem;
  padding: 0.4rem 0;
  border-bottom: 1px dotted var(--color-border-alt);
}

.lane:last-of-type {
  border-bottom: none;
}

.lane--main {
  border-bottom-style: solid;
  border-bottom-color: var(--color-border);
}

.lane-name {
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
}

.lane-stat {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.lane-size,
.lane-est {
  font-size: 0.95rem;
  color: var(--color-text);
}

.lane-stat-label {
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
}

.lane-size-input {
  width: 2.6rem;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
  padding: 0.05rem 0.2rem;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  text-align: right;
  -moz-appearance: textfield;
  appearance: textfield;
}

.lane-size-input:focus {
  outline: none;
  border-bottom-color: var(--color-accent);
}

.lane-size-input::-webkit-outer-spin-button,
.lane-size-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.lane-remove {
  background: none;
  border: none;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.95rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0 0.25rem;
  justify-self: end;
}

.lane-remove:hover {
  color: var(--color-invalid, #c00);
}

.lane-add {
  background: none;
  border: none;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.3rem 0;
  text-align: left;
  align-self: flex-start;
}

.lane-add:hover:not(:disabled) {
  color: var(--color-text);
}

.lane-add:disabled {
  cursor: default;
  opacity: 0.4;
}

.lane-warning {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-invalid, #c00);
  margin: 0.25rem 0 0;
}

@media (max-width: 640px) {
  .division {
    grid-template-columns: 1fr;
  }
}

@media print {
  .draft-badge,
  .lane-add,
  .lane-remove {
    display: none;
  }
  .lane-size-input {
    border-bottom: none;
  }
}
</style>
