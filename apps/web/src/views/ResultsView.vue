<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ApiError,
  divisionStandings,
  type StandingsWarning,
  type TeamStanding,
  type TieBreak,
} from '@qzr/shared'
import { formatSlotTime } from '@qzr/ui'

import { getMeet, listResults, setResultsCounted, type MeetDetail } from '../api'
import { countedQuizzes, groupResults, type DivisionResults, type ResultRow } from '../results'

const props = defineProps<{ slug: string }>()
const router = useRouter()

const meet = ref<MeetDetail['meet'] | null>(null)
const divisions = ref<DivisionResults[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const countError = ref('')

/** Each division that has counted quizzes, with its standings */
const standings = computed(() =>
  divisions.value
    .map((group) => ({ division: group.division, counted: countedQuizzes(group) }))
    .filter(({ counted }) => counted.length > 0)
    .map(({ division, counted }) => ({ division, ...divisionStandings(counted) })),
)
const allQuizzes = computed(() => divisions.value.flatMap((group) => group.quizzes))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { meet: detail } = await getMeet(props.slug)
    meet.value = detail
    divisions.value = groupResults(await listResults(detail.id))
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 403
        ? "Only the meet's admins can see its results."
        : (e as Error).message
  } finally {
    loading.value = false
  }
}

/**
 * Count or uncount quizzes, showing the change at once and undoing it if the server refuses. Once
 * it succeeds every quiz sent has that value, whichever of them actually changed.
 */
async function setCounted(quizzes: ResultRow[], counted: boolean) {
  if (!meet.value || quizzes.length === 0) return
  const before = quizzes.map((quiz) => quiz.counted)
  for (const quiz of quizzes) quiz.counted = counted
  saving.value = true
  countError.value = ''
  try {
    await setResultsCounted(
      meet.value.id,
      quizzes.map((quiz) => quiz.id),
      counted,
    )
  } catch (e) {
    quizzes.forEach((quiz, i) => (quiz.counted = before[i]!))
    countError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

const TIE_BREAKS: Record<TieBreak, string> = {
  headToHead: 'head-to-head',
  points: 'total points',
  errors: 'fewest errors',
}

function warningText(warning: StandingsWarning, teams: TeamStanding[]): string {
  switch (warning.kind) {
    case 'unequalQuizCounts':
      return `Teams have played different numbers of counted quizzes: ${teams
        .map((t) => `${t.name} ${t.quizzes}`)
        .join(', ')}.`
    case 'unplaced':
      return `${warning.quiz} can't be placed (questions unanswered or validation errors), so it adds nothing.`
    case 'finalTie':
      return `${warning.teams.join(', ')} are tied for the last places in the final. Settle it away from the app.`
  }
}

const ORDINALS = ['', '1st', '2nd', '3rd']

/** A place key counts teams sharing it after the decimal point (1.2: two tied for first) */
function placeLabel(place: number): string {
  const label = ORDINALS[Math.floor(place)] ?? String(place)
  return Number.isInteger(place) ? label : `tied ${label}`
}

onMounted(load)
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'meet', params: { slug } })">
      ← {{ meet?.name || 'QuizMeet' }}
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet">
      <h2 class="page-title">Results: {{ meet.name }}</h2>
      <p v-if="divisions.length === 0" class="state-msg">No quizzes submitted yet.</p>

      <template v-else>
        <h3 class="section-title">Standings</h3>
        <p v-if="standings.length === 0" class="state-msg">
          Count quizzes below, normally the prelims, to see each division's standings.
        </p>
        <section v-for="division in standings" :key="division.division" class="division">
          <h4 class="division-title">Division {{ division.division }}</h4>
          <table class="results-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Team</th>
                <th>Placement points</th>
                <th>Quizzes</th>
                <th>Tie-break</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="team in division.teams" :key="team.name">
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
          <ul v-if="division.warnings.length > 0" class="warnings">
            <li v-for="(warning, i) in division.warnings" :key="i">
              {{ warningText(warning, division.teams) }}
            </li>
          </ul>
        </section>

        <div class="quizzes-header">
          <h3 class="section-title">Quizzes</h3>
          <button
            class="btn btn--secondary btn--sm"
            :disabled="saving"
            @click="setCounted(allQuizzes, true)"
          >
            Count all
          </button>
          <button
            class="btn btn--secondary btn--sm"
            :disabled="saving"
            @click="setCounted(allQuizzes, false)"
          >
            Uncount all
          </button>
        </div>
        <p v-if="countError" class="state-msg state-msg--error">{{ countError }}</p>
      </template>

      <section v-for="group in divisions" :key="group.division" class="division">
        <h3 class="division-title">Division {{ group.division }}</h3>
        <table class="results-table">
          <thead>
            <tr>
              <th>Quiz</th>
              <th>Teams</th>
              <th>From</th>
              <th>Revision</th>
              <th>Last saved</th>
              <th>Counted</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="quiz in group.quizzes" :key="quiz.id">
              <td>{{ quiz.name }}</td>
              <td>
                <span v-for="team in quiz.teams" :key="team.name" class="team">
                  {{ team.name }} <strong>{{ team.score }}</strong>
                  <span v-if="team.place !== null" class="note">
                    {{ placeLabel(team.place) }}, {{ team.placementPoints }} pts
                  </span>
                </span>
                <span v-if="!quiz.placed" class="note">not placed yet</span>
              </td>
              <td>{{ quiz.from }}</td>
              <td>{{ quiz.revision }}</td>
              <td>{{ quiz.savedBy }}, {{ quiz.action }}, {{ formatSlotTime(quiz.savedAt) }}</td>
              <td>
                <input
                  type="checkbox"
                  :checked="quiz.counted"
                  :disabled="saving"
                  :aria-label="`Count ${quiz.name}`"
                  @change="setCounted([quiz], ($event.target as HTMLInputElement).checked)"
                />
              </td>
            </tr>
          </tbody>
        </table>
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

.division {
  margin-bottom: 2rem;
}

.division-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-heading);
  margin-bottom: 0.5rem;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.results-table th,
.results-table td {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

.results-table th {
  color: var(--color-text-faint);
  font-weight: 600;
}

.team {
  margin-right: 0.75rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-bottom: 1rem;
}

.quizzes-header {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-top: 1rem;
}

.quizzes-header .section-title {
  margin-right: auto;
}

.btn {
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}

.btn--sm {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.btn--secondary:hover:not(:disabled) {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.finalist {
  margin-left: 0.4rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-accent);
}

.warnings {
  margin-top: 0.5rem;
  padding-left: 1.25rem;
  font-size: 0.8rem;
  color: var(--palette-error);
}

.note {
  color: var(--color-text-faint);
  font-style: italic;
}
</style>
