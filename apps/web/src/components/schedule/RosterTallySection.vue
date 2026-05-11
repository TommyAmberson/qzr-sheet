<script setup lang="ts">
import { type ExtraLane, type LaneId } from '../../brackets'

defineProps<{
  divisions: string[]
  teamCounts: Record<string, number>
  extraLanes: Record<string, ExtraLane[]>
  editable: boolean
}>()

defineEmits<{
  (e: 'toggle-lane', payload: { division: string; lane: LaneId }): void
  (e: 'resize-lane', payload: { division: string; lane: LaneId; teamCount: number }): void
}>()
</script>

<template>
  <section class="roster-tally">
    <header class="section-head">
      <h2 class="section-title">Roster</h2>
      <p class="section-meta">{{ divisions.length }} divisions · format draft</p>
    </header>
    <p class="placeholder">Section in progress.</p>
  </section>
</template>

<style scoped>
.roster-tally {
  padding: 1.25rem 0 1rem;
  border-top: 2px solid var(--color-text);
  margin-top: 1rem;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.section-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.45rem;
  margin: 0;
  letter-spacing: -0.01em;
  color: var(--color-heading);
}

.section-meta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--color-text-faint);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.placeholder {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--color-text-faint);
  margin: 0;
}
</style>
