<script setup lang="ts">
import { computed } from 'vue'

import {
  estimateLaneQuizzes,
  laneLabel,
  TOGGLEABLE_LANES,
  type ExtraLane,
  type LaneId,
} from '../brackets'

const props = defineProps<{
  divisions: string[]
  /** division → team count, derived from registered roster. */
  teamCounts: Record<string, number>
  /** division → enabled extra lanes with their team-count split. */
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
  prelimQuizzes: number
  lanes: RenderLane[]
  elimEstimate: number
  /** True if extra lanes claim more teams than the division has. */
  oversubscribed: boolean
}

const rows = computed<DivisionRow[]>(() =>
  props.divisions.map((d) => {
    const teamCount = props.teamCounts[d] ?? 0
    const extras = props.extraLanes[d] ?? []
    const usedByExtras = extras.reduce((sum, l) => sum + l.teamCount, 0)
    const mainSize = Math.max(0, teamCount - usedByExtras)
    const oversubscribed = usedByExtras > teamCount

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
      prelimQuizzes: teamCount, // # prelim quizzes == # teams (rules.md)
      lanes,
      elimEstimate: lanes.reduce((sum, l) => sum + l.estimate, 0),
      oversubscribed,
    }
  }),
)

const totals = computed(() => {
  let prelim = 0
  let elim = 0
  for (const r of rows.value) {
    prelim += r.prelimQuizzes
    elim += r.elimEstimate
  }
  return { prelim, elim, total: prelim + elim }
})

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
  <section class="format-header" :data-editable="editable">
    <header class="format-header-row">
      <h3 class="format-title">Format</h3>
      <div class="budget">
        <span class="budget-num">{{ totals.prelim }}</span>
        <span class="budget-label">prelim</span>
        <span class="budget-sep">+</span>
        <span class="budget-num">~{{ totals.elim }}</span>
        <span class="budget-label">elim</span>
        <span class="budget-sep">=</span>
        <span class="budget-num budget-total">{{ totals.total }}</span>
        <span class="budget-label">quizzes</span>
      </div>
    </header>

    <div class="divisions">
      <div v-for="row in rows" :key="row.division" class="division-row">
        <div class="division-meta">
          <span class="division-name">Div {{ row.division }}</span>
          <span class="division-counts">
            <strong>{{ row.teamCount }}</strong> teams
            <span class="division-counts-sep">·</span>
            <strong>{{ row.prelimQuizzes }}</strong> prelim
            <template v-if="row.elimEstimate > 0">
              <span class="division-counts-sep">·</span>
              <strong>~{{ row.elimEstimate }}</strong> elim
            </template>
            <span v-if="row.oversubscribed" class="division-warn" title="Lane sizes exceed teams">
              over by {{ row.lanes.reduce((s, l) => s + l.teamCount, 0) - row.teamCount }}
            </span>
          </span>
        </div>

        <div class="lanes">
          <span
            v-for="lane in row.lanes"
            :key="lane.id"
            class="lane-chip lane-chip--enabled"
            :class="{ 'lane-chip--main': lane.id === 'main' }"
          >
            <span class="lane-name">{{ lane.label }}</span>
            <input
              v-if="lane.resizable && editable"
              class="lane-size-input"
              type="number"
              min="0"
              :value="lane.teamCount"
              @input="onSizeInput(row.division, lane.id, $event)"
            />
            <span v-else class="lane-size">{{ lane.teamCount }}</span>
            <span class="lane-est">~{{ lane.estimate }}</span>
            <button
              v-if="lane.removable && editable"
              type="button"
              class="lane-remove"
              :title="`Remove ${lane.label}`"
              @click="emit('toggle-lane', { division: row.division, lane: lane.id })"
            >
              ×
            </button>
          </span>
          <button
            v-for="lane in TOGGLEABLE_LANES.filter((l) => !isEnabled(row.division, l))"
            :key="lane"
            type="button"
            class="lane-chip lane-chip--add"
            :disabled="!editable"
            :title="`Add ${laneLabel(row.division, lane)}`"
            @click="emit('toggle-lane', { division: row.division, lane })"
          >
            + {{ laneLabel(row.division, lane) }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="editable" class="format-note">
      Lane picks are unsaved drafts — they drive in-editor advice. Persistence ships with the full
      elim builder.
    </p>
  </section>
</template>

<style scoped>
.format-header {
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.75rem;
  background: var(--color-bg-raised);
  font-size: 0.78rem;
}

.format-header-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.format-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
}

.budget {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.budget-num {
  font-weight: 600;
  color: var(--color-text);
}

.budget-total {
  color: var(--color-accent, var(--color-text));
}

.budget-label {
  color: var(--color-text-faint);
}

.budget-sep {
  color: var(--color-text-faint);
  margin: 0 0.05rem;
}

.divisions {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.division-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.division-meta {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 13rem;
}

.division-name {
  font-weight: 700;
  color: var(--color-text);
}

.division-counts {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.division-counts strong {
  color: var(--color-text);
  font-weight: 600;
}

.division-counts-sep {
  color: var(--color-text-faint);
  margin: 0 0.2rem;
}

.division-warn {
  margin-left: 0.4rem;
  color: var(--color-invalid, #c00);
  font-weight: 600;
  font-size: 0.7rem;
}

.lanes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.lane-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font: inherit;
  font-size: 0.72rem;
  padding: 0.15rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 99px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.lane-chip--enabled {
  background: var(--color-bg);
  color: var(--color-text);
  border-color: var(--color-text-muted);
  font-weight: 600;
}

.lane-chip--main {
  border-color: var(--color-border);
}

.lane-name {
  font-weight: 600;
}

.lane-size {
  color: var(--color-text-muted);
  font-weight: 400;
}

.lane-size-input {
  width: 2.4rem;
  font: inherit;
  font-size: 0.72rem;
  padding: 0.05rem 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: var(--color-bg);
  color: var(--color-text);
  text-align: right;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
  appearance: textfield;
}

.lane-size-input::-webkit-outer-spin-button,
.lane-size-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.lane-est {
  color: var(--color-text-faint);
  font-weight: 400;
  font-size: 0.68rem;
}

.lane-remove {
  background: none;
  border: none;
  padding: 0 0.1rem;
  font: inherit;
  font-size: 0.85rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
}

.lane-remove:hover {
  color: var(--color-invalid, #c00);
}

.lane-chip--add {
  cursor: pointer;
  border-style: dashed;
  color: var(--color-text-faint);
}

.lane-chip--add:hover:not(:disabled) {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.lane-chip--add:disabled {
  opacity: 0.45;
  cursor: default;
}

.format-note {
  font-size: 0.7rem;
  color: var(--color-text-faint);
  margin: 0.5rem 0 0;
}
</style>
