<script setup lang="ts">
import { computed } from 'vue'

import { type MeetTeamRow } from '../../api'

const props = defineProps<{
  divisions: string[]
  teamCounts: Record<string, number>
  teams: MeetTeamRow[]
  editable: boolean
}>()

const emit = defineEmits<{
  (e: 'update-team-lateness', payload: { teamId: number; lateness: boolean }): void
}>()

interface DivisionGroup {
  division: string
  teamCount: number
  teams: MeetTeamRow[]
}

const groups = computed<DivisionGroup[]>(() =>
  props.divisions.map((d) => ({
    division: d,
    teamCount: props.teamCounts[d] ?? 0,
    teams: props.teams.filter((t) => t.division === d),
  })),
)

// Per `docs/rules.md`, # prelim quizzes = # teams.
const totalTeams = computed(() => groups.value.reduce((sum, g) => sum + g.teamCount, 0))
const totalLate = computed(() => props.teams.filter((t) => t.lateness).length)

function teamLabel(t: MeetTeamRow): string {
  return `${t.churchShortName} ${t.number}`
}

function onToggleLate(team: MeetTeamRow, event: Event) {
  const lateness = (event.target as HTMLInputElement).checked
  emit('update-team-lateness', { teamId: team.id, lateness })
}
</script>

<template>
  <section class="section">
    <div class="section-header">
      <h3 class="section-title">Prelim setup</h3>
      <span class="section-meta">
        {{ totalTeams }} teams · {{ totalTeams }} prelim quizzes
        <template v-if="totalLate > 0"> · {{ totalLate }} late</template>
      </span>
    </div>

    <div v-for="group in groups" :key="group.division" class="division-block">
      <header class="division-head">
        <span class="division-name">Div {{ group.division }}</span>
        <span class="division-stats">
          <strong>{{ group.teamCount }}</strong> teams ·
          <strong>{{ group.teamCount }}</strong> prelim quizzes
        </span>
      </header>
      <ul v-if="group.teams.length > 0" class="team-list">
        <li v-for="team in group.teams" :key="team.id" class="team-row">
          <span class="team-name">{{ teamLabel(team) }}</span>
          <label class="late-toggle" :class="{ 'is-late': team.lateness }">
            <input
              type="checkbox"
              :checked="team.lateness"
              :disabled="!editable"
              @change="onToggleLate(team, $event)"
            />
            <span>Late</span>
          </label>
        </li>
      </ul>
      <p v-else class="empty">No teams registered in this division yet.</p>
    </div>

    <p class="hint">
      Mark a team <em>Late</em> to push it to a higher-numbered letter when Roll Teams runs — its
      first prelim quiz will land in a later round, giving a delayed bus more time to arrive.
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

.division-block {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.6rem 0.875rem 0.7rem;
  margin-bottom: 0.5rem;
}

.division-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.4rem;
  margin-bottom: 0.4rem;
  border-bottom: 1px solid var(--color-border-alt);
}

.division-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
}

.division-stats {
  font-size: 0.78rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.division-stats strong {
  color: var(--color-text);
  font-weight: 600;
}

.team-list {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 0.25rem 0.75rem;
  margin: 0;
  padding: 0;
}

.team-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.2rem 0.1rem;
  font-size: 0.82rem;
  color: var(--color-text);
}

.team-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.late-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  color: var(--color-text-faint);
  cursor: pointer;
  user-select: none;
}

.late-toggle.is-late {
  color: var(--palette-amber);
  font-weight: 600;
}

.late-toggle input {
  accent-color: var(--palette-amber);
}

.empty {
  font-size: 0.78rem;
  color: var(--color-text-faint);
  margin: 0.25rem 0 0;
  font-style: italic;
}

.hint {
  font-size: 0.78rem;
  color: var(--color-text-faint);
  margin: 0.85rem 0 0;
  max-width: 38rem;
  line-height: 1.5;
}

.hint em {
  font-style: normal;
  color: var(--palette-amber);
  font-weight: 600;
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
