<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@qzr/shared'
import { formatSlotTime } from '@qzr/ui'

import { getMeet, listResults, type MeetDetail } from '../api'
import { groupResults, type DivisionResults } from '../results'

const props = defineProps<{ slug: string }>()
const router = useRouter()

const meet = ref<MeetDetail['meet'] | null>(null)
const divisions = ref<DivisionResults[]>([])
const loading = ref(true)
const error = ref('')

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

      <section v-for="group in divisions" :key="group.division" class="division">
        <h3 class="division-title">Division {{ group.division }}</h3>
        <table class="results-table">
          <thead>
            <tr>
              <th>Quiz</th>
              <th>Teams</th>
              <th>Room</th>
              <th>Revision</th>
              <th>Last saved</th>
              <th>Standings</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="quiz in group.quizzes" :key="quiz.id">
              <td>{{ quiz.quizNumber }}</td>
              <td>
                <span v-for="team in quiz.teams" :key="team.name" class="team">
                  {{ team.name }} <strong>{{ team.score }}</strong>
                  <span v-if="team.place !== null" class="note">
                    {{ placeLabel(team.place) }}, {{ team.placementPoints }} pts
                  </span>
                </span>
                <span v-if="!quiz.placed" class="note">not placed yet</span>
              </td>
              <td>{{ quiz.room ?? 'Uploaded' }}</td>
              <td>{{ quiz.revision }}</td>
              <td>{{ quiz.savedBy }}, {{ quiz.action }}, {{ formatSlotTime(quiz.savedAt) }}</td>
              <td>{{ quiz.counted ? 'Counted' : 'Not counted' }}</td>
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

.note {
  color: var(--color-text-faint);
  font-style: italic;
}
</style>
