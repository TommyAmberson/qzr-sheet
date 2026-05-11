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
  prelimQuizzes: number
}

const rows = computed<DivisionRow[]>(() =>
  props.divisions.map((d) => ({
    division: d,
    teamCount: props.teamCounts[d] ?? 0,
    prelimQuizzes: props.teamCounts[d] ?? 0,
  })),
)

const totalTeams = computed(() => rows.value.reduce((sum, r) => sum + r.teamCount, 0))
const totalPrelim = computed(() => rows.value.reduce((sum, r) => sum + r.prelimQuizzes, 0))
</script>

<template>
  <section class="prelim-setup">
    <header class="section-head">
      <h2 class="section-title">Prelim setup</h2>
      <p class="section-meta">
        <span>{{ divisions.length }} divisions</span>
        <span class="rule" aria-hidden="true">/</span>
        <span>{{ totalTeams }} teams</span>
        <span class="rule" aria-hidden="true">/</span>
        <span>{{ totalPrelim }} prelim quizzes</span>
      </p>
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
              <dt>Prelim quizzes</dt>
              <dd>{{ row.prelimQuizzes }}</dd>
            </div>
          </dl>
        </div>
        <p class="lateness-placeholder">
          Per-team lateness flags ship with Roll Teams (#39). They'll bias the prelim draw so late
          buses land in higher-numbered letter slots.
        </p>
      </li>
    </ol>

    <p v-if="editable" class="editable-note">
      Team roster is edited in <em>Churches</em> on the meet dashboard, not here.
    </p>
  </section>
</template>

<style scoped>
.prelim-setup {
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

.divisions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.division {
  display: grid;
  grid-template-columns: minmax(0, 16rem) minmax(0, 1fr);
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

.lateness-placeholder {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.92rem;
  line-height: 1.45;
  color: var(--color-text-muted);
  margin: 0;
  max-width: 36rem;
}

.editable-note {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 1rem 0 0;
  padding: 0.55rem 0 0;
  border-top: 1px dashed var(--color-border);
}

.editable-note em {
  font-style: normal;
  color: var(--color-text-muted);
  text-transform: none;
  letter-spacing: 0.02em;
}

@media (max-width: 640px) {
  .division {
    grid-template-columns: 1fr;
  }
}

@media print {
  .editable-note {
    display: none;
  }
}
</style>
