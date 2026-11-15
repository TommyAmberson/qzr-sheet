<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError, type DivisionStats, type Stage } from '@qzr/shared'

import { getDivisionStats, getMeet, type MeetDetail } from '../api'
import { TIE_BREAKS, placeLabel, problemText, warningText } from '../stats'

const props = defineProps<{ slug: string; division: string }>()
const router = useRouter()

const meet = ref<MeetDetail['meet'] | null>(null)
const stats = ref<DivisionStats | null>(null)
const loading = ref(true)
const error = ref('')

const STAGE_TITLES: Record<Stage, string> = {
  prelim: 'Prelims',
  intermediate: 'Intermediates',
  elimination: 'Eliminations',
  finals: 'Finals',
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { meet: detail } = await getMeet(props.slug)
    meet.value = detail
    stats.value = await getDivisionStats(detail.id, props.division)
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 403
        ? "Only the meet's admins can see its stats."
        : e instanceof ApiError && e.status === 503
          ? 'The stats are still being prepared. Try again in a moment.'
          : (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [props.slug, props.division], load)
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'meet-results', params: { slug } })">
      ← Results
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet && stats">
      <h2 class="page-title">Division {{ stats.division }} stats: {{ meet.name }}</h2>

      <ul v-if="stats.warnings?.length" class="warnings">
        <li v-for="(warning, i) in stats.warnings" :key="i">{{ warningText(warning) }}</li>
      </ul>

      <section v-if="stats.prelimStandings" class="block">
        <h3 class="section-title">Prelim standings</h3>
        <p v-if="stats.prelimStandings.teams.length === 0" class="state-msg">
          No prelim counts yet. Count quizzes on the results page to see the standings.
        </p>
        <div v-else class="table-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Team</th>
                <th title="Placement points">Points</th>
                <th>Quizzes</th>
                <th>Tie-break</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="team in stats.prelimStandings.teams" :key="team.name">
                <td>{{ team.tied ? `T${team.rank}` : team.rank }}</td>
                <td>
                  {{ team.name }}
                  <span v-if="team.finalist" class="finalist">Final</span>
                </td>
                <td>{{ team.placementPoints }}</td>
                <td>{{ team.quizzes }}</td>
                <td>
                  {{ team.tied ? 'still tied' : team.decidedBy ? TIE_BREAKS[team.decidedBy] : '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-for="stage in stats.results" :key="stage.stage" class="block">
        <h3 class="section-title">{{ STAGE_TITLES[stage.stage] }}</h3>
        <div class="table-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Quiz</th>
                <th>Teams</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="quiz in stage.quizzes" :key="quiz.id ?? quiz.name">
                <td class="cell-quiz">
                  <router-link
                    v-if="quiz.id !== undefined"
                    :to="{ name: 'meet-result', params: { slug, resultId: quiz.id } }"
                  >
                    {{ quiz.name }}
                  </router-link>
                  <template v-else>{{ quiz.name }}</template>
                </td>
                <td>
                  <ul class="teams">
                    <li v-for="team in quiz.teams" :key="team.name">
                      {{ team.name }}
                      <strong v-if="team.score !== undefined">{{ team.score }}</strong>
                      <span v-if="team.place !== undefined" class="note">
                        {{ placeLabel(team.place, team.tiedWith) }}
                      </span>
                    </li>
                    <li v-if="quiz.status === 'underReview'" class="note">under review</li>
                    <li v-for="(problem, i) in quiz.problems ?? []" :key="i" class="problem">
                      {{ problemText(problem) }}
                    </li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.container {
  max-width: 64rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.back-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.8rem;
  color: var(--color-text-faint);
  cursor: pointer;
  font-family: inherit;
  margin-bottom: 1.5rem;
  display: inline-block;
}

.back-link:hover {
  color: var(--color-text-muted);
}

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
}

.state-msg--error {
  color: var(--palette-error);
}

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 1.25rem;
}

.block {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-heading);
  margin-bottom: 0.5rem;
}

/* A wide table scrolls inside its own box, never the page */
.table-scroll {
  overflow-x: auto;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.stats-table th,
.stats-table td {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.stats-table th {
  color: var(--color-text-faint);
  font-weight: 600;
}

.cell-quiz {
  white-space: nowrap;
  font-weight: 600;
}

.teams {
  list-style: none;
  padding: 0;
  margin: 0;
}

/* Vue drops the line break between a team's score and its place, so space them here */
.teams li > .note {
  margin-left: 0.3rem;
}

.finalist {
  margin-left: 0.4rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-accent);
}

.warnings {
  margin: 0 0 1.5rem;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  color: var(--palette-error);
}

.note {
  color: var(--color-text-faint);
  font-style: italic;
}

.problem {
  color: var(--palette-error);
}
</style>
