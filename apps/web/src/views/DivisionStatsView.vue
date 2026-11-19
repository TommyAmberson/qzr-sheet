<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError, type DivisionStats, type Stage, divisionTitle } from '@qzr/shared'

import { getDivisionStats, getMeet, keepQuiz, type MeetDetail } from '../api'
import StandingState from '../components/StandingState.vue'
import { TIE_BREAKS, flagText, placeLabel, problemText, warningText } from '../stats'

/**
 * A division's stats for every member of the meet, signed in or a guest, as far as the meet's
 * settings give them (FR-018 to FR-021); an admin sees everything, and may look as a viewer
 */
const props = defineProps<{ slug: string; division: string }>()
const route = useRoute()
const router = useRouter()

/** An admin looking at the page as its viewers see it (FR-023c) */
const asViewer = computed(() => route.query.as === 'viewer')
/** Whether this reader is shown warnings, so is one of the meet's admins */
const admin = computed(() => stats.value?.warnings !== undefined)

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

/** The newest load; one for a division the page has since left must not show */
let loads = 0

async function load() {
  const current = ++loads
  loading.value = true
  error.value = ''
  try {
    const { meet: detail } = await getMeet(props.slug)
    const read = await getDivisionStats(detail.id, props.division, asViewer.value)
    if (current !== loads) return
    meet.value = detail
    stats.value = read
  } catch (e) {
    if (current !== loads) return
    error.value =
      e instanceof ApiError && e.status === 403
        ? "Only the meet's members can see its stats."
        : e instanceof ApiError && e.status === 503
          ? 'The stats are still being prepared. Try again in a moment.'
          : (e as Error).message
  } finally {
    if (current === loads) loading.value = false
  }
}

onMounted(load)
watch(() => [props.slug, props.division, asViewer.value], load)

/** Keep a quiz seated from a withdrawn order as it is, clearing its flag */
async function keep(resultId: number) {
  if (!meet.value) return
  try {
    await keepQuiz(meet.value.id, resultId)
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'meet-stats', params: { slug } })">
      ← Stats
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet && stats">
      <h2 class="page-title">{{ divisionTitle(stats.division) }} stats: {{ meet.name }}</h2>
      <p v-if="asViewer" class="viewer-note">
        As a viewer sees it.
        <router-link :to="{ query: {} }">See everything</router-link>
      </p>

      <ul v-if="stats.warnings?.length" class="warnings">
        <li v-for="(warning, i) in stats.warnings" :key="i">{{ warningText(warning) }}</li>
      </ul>

      <section v-if="!stats.prelimStandings" class="block">
        <h3 class="section-title">Prelim standings</h3>
        <p class="state-msg">Not available yet.</p>
      </section>
      <section v-else class="block">
        <h3 class="section-title">
          Prelim standings
          <StandingState :state="stats.prelimStandings.state" />
        </h3>
        <p v-if="stats.prelimStandings.confirmed" class="note">
          Confirmed by {{ stats.prelimStandings.confirmed.by }}, in the elimination draw.
        </p>
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

      <section v-if="stats.prelimStandings?.current" class="block">
        <h3 class="section-title">Prelim standings as they stand now</h3>
        <p class="note">
          A prelim has changed since the order was confirmed. The confirmed order stands; this is
          the current one.
        </p>
        <div class="table-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Team</th>
                <th title="Placement points">Points</th>
                <th>Quizzes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="team in stats.prelimStandings.current" :key="team.name">
                <td>{{ team.tied ? `T${team.rank}` : team.rank }}</td>
                <td>{{ team.name }}</td>
                <td>{{ team.placementPoints }}</td>
                <td>{{ team.quizzes }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="stats.rerank" class="block">
        <h3 class="section-title">
          After the intermediates
          <StandingState :state="stats.rerank.state" />
        </h3>
        <div class="table-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th>New rank</th>
                <th>Team</th>
                <th title="Prelim placement points plus the intermediate's">Points</th>
                <th>Quizzes</th>
                <th>Tie-break</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="team in stats.rerank.teams" :key="team.name">
                <td>{{ team.rank }}</td>
                <td>{{ team.name }}</td>
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

      <section v-if="!stats.quizzers" class="block">
        <h3 class="section-title">Quizzer standings</h3>
        <p class="state-msg">Not available yet.</p>
      </section>
      <section v-else class="block">
        <h3 class="section-title">
          Quizzer standings
          <StandingState :state="stats.quizzers.state" />
        </h3>
        <p v-if="stats.quizzers.lists.length === 0" class="state-msg">
          No quiz counts for quizzers yet.
        </p>
        <template v-for="list in stats.quizzers.lists" :key="String(list.consolation)">
          <h4 v-if="list.consolation" class="list-title">Consolation</h4>
          <div class="table-scroll">
            <table class="stats-table">
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Quizzer</th>
                  <th>Team</th>
                  <th>Average</th>
                  <th>Errors</th>
                  <th>Jumps</th>
                  <th title="Total points">Points</th>
                  <th title="Quizzes the team played">Quizzes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="quizzer in list.quizzers" :key="`${quizzer.team}|${quizzer.name}`">
                  <td>{{ quizzer.place }}</td>
                  <td>{{ quizzer.name }}</td>
                  <td>{{ quizzer.team }}</td>
                  <td>{{ quizzer.average.toFixed(2) }}</td>
                  <td>{{ quizzer.errors }}</td>
                  <td>{{ quizzer.jumps }}</td>
                  <td>{{ quizzer.points }}</td>
                  <td>{{ quizzer.quizzes }}</td>
                  <td class="flags">
                    <span v-for="(flag, i) in quizzer.flags" :key="i">{{ flagText(flag) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>

      <p v-if="stats.results.length === 0" class="state-msg">No quiz results to show yet.</p>
      <section v-for="stage in stats.results" :key="stage.stage" class="block">
        <h3 class="section-title">{{ STAGE_TITLES[stage.stage] }}</h3>
        <ol v-for="medals in stage.medals ?? []" :key="String(medals.consolation)" class="medals">
          <li v-for="(team, i) in medals.teams" :key="team">
            <span class="note"
              >{{ medals.consolation ? 'Consolation ' : '' }}{{ placeLabel(i + 1) }}</span
            >
            {{ team }}
          </li>
        </ol>
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
                    <li v-if="quiz.status === 'accepted'" class="note">accepted as scored</li>
                    <li v-if="quiz.incompleteTypes" class="note">question types incomplete</li>
                    <li v-if="quiz.withdrawnOrder" class="problem">
                      Seated from an order since withdrawn.
                      <button
                        v-if="admin && quiz.id !== undefined"
                        class="keep"
                        @click="keep(quiz.id)"
                      >
                        Keep as it is
                      </button>
                    </li>
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

.medals {
  list-style: none;
  padding: 0;
  margin: 0 0 0.75rem;
  font-size: 0.9rem;
  font-weight: 600;
}

.medals .note {
  display: inline-block;
  min-width: 3rem;
  font-weight: 400;
}

.list-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-heading);
  margin: 1rem 0 0.4rem;
}

.flags {
  color: var(--palette-error);
}

.flags span + span::before {
  content: '; ';
}

.note {
  color: var(--color-text-faint);
  font-style: italic;
}

.problem {
  color: var(--palette-error);
}

.viewer-note {
  margin: -0.75rem 0 1.25rem;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.keep {
  margin-left: 0.4rem;
  font: inherit;
  font-size: 0.75rem;
}
</style>
