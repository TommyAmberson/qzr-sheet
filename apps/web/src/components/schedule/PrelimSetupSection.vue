<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  divisions: string[]
  teamCounts: Record<string, number>
  editable: boolean
}>()

interface DivisionRow {
  division: string
  teamCount: number
}

const rows = computed<DivisionRow[]>(() =>
  props.divisions.map((d) => ({
    division: d,
    teamCount: props.teamCounts[d] ?? 0,
  })),
)

// Per `docs/rules.md`, # prelim quizzes = # teams.
const totalTeams = computed(() => rows.value.reduce((sum, r) => sum + r.teamCount, 0))
</script>

<template>
  <section class="section">
    <div class="section-header">
      <h3 class="section-title">Prelim setup</h3>
      <span class="section-meta"> {{ totalTeams }} teams · {{ totalTeams }} prelim quizzes </span>
    </div>

    <ul class="item-list">
      <li v-for="row in rows" :key="row.division" class="item-row">
        <span class="item-label">Div {{ row.division }}</span>
        <span class="item-stats">
          <strong>{{ row.teamCount }}</strong> teams · <strong>{{ row.teamCount }}</strong> prelim
          quizzes
        </span>
      </li>
    </ul>

    <p class="hint">
      Per-team lateness flags will appear here once team-name resolution ships. They bias the prelim
      draw so a late bus lands in higher-numbered letter slots.
    </p>

    <p v-if="editable" class="footnote">
      Team roster is edited in <em>Churches</em> on the meet dashboard, not here.
    </p>
  </section>
</template>

<style scoped>
.section {
  margin-bottom: 2rem;
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
}

.section-meta {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
}

.item-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
}

.item-row {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.55rem 0.875rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
}

.item-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  flex-shrink: 0;
  min-width: 4rem;
}

.item-stats {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.item-stats strong {
  color: var(--color-text);
  font-weight: 600;
}

.hint {
  font-size: 0.78rem;
  color: var(--color-text-faint);
  margin: 0.85rem 0 0;
  max-width: 36rem;
  line-height: 1.5;
}

.footnote {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  margin: 0.5rem 0 0;
}

.footnote em {
  font-style: normal;
  color: var(--color-text-muted);
}
</style>
