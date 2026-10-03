<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError, deserialize, quizName, quizOutcome, type QuizFile } from '@qzr/shared'

import {
  editResult,
  getHistory,
  getMeet,
  restoreRevision,
  type HistoryEntry,
  type MeetDetail,
} from '../api'
import { editQuizFile } from '../results'

const props = defineProps<{ slug: string; resultId: string }>()
const router = useRouter()
const resultId = Number(props.resultId)

const meet = ref<MeetDetail['meet'] | null>(null)
const history = ref<HistoryEntry[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const saveError = ref('')

type Save = Extract<HistoryEntry, { kind: 'revision' }>

/** The current revision: the newest save */
const current = computed(() =>
  history.value.find((entry): entry is Save => entry.kind === 'revision'),
)
const currentFile = computed(() => current.value?.quizFile)
/** Each save's teams and scores, as the scoresheet places them, worked out once per load */
const teamsByRevision = computed(
  () =>
    new Map(
      history.value.flatMap((entry) =>
        entry.kind === 'revision'
          ? [[entry.revision, quizOutcome(deserialize(entry.quizFile)).teams] as const]
          : [],
      ),
    ),
)

// The quick form (T026), filled from the current file
const form = ref({
  division: '',
  quizNumber: '',
  teams: [] as { id: number; name: string; quizzers: { id: number; name: string }[] }[],
})

function fillForm(file: QuizFile) {
  form.value = {
    division: file.quiz.division,
    quizNumber: file.quiz.quizNumber,
    teams: file.teams.map((team) => ({
      id: team.id,
      name: team.name,
      quizzers: team.quizzers.map((q) => ({ id: q.id, name: q.name })),
    })),
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { meet: detail } = await getMeet(props.slug)
    meet.value = detail
    history.value = await getHistory(detail.id, resultId)
    if (currentFile.value) fillForm(currentFile.value)
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 401
        ? 'Join the meet again with your room code to see this quiz.'
        : e instanceof ApiError && e.status === 403
          ? "Only the meet's admins and this quiz's room officials can see it."
          : (e as Error).message
  } finally {
    loading.value = false
  }
}

/** Save the quick form's names as a new revision */
async function saveForm() {
  if (!meet.value || !currentFile.value) return
  saving.value = true
  saveError.value = ''
  try {
    const edited = editQuizFile(currentFile.value, {
      division: form.value.division,
      quizNumber: form.value.quizNumber,
      teamNames: new Map(form.value.teams.map((team) => [team.id, team.name])),
      quizzerNames: new Map(
        form.value.teams.flatMap((team) => team.quizzers.map((q) => [q.id, q.name] as const)),
      ),
    })
    await editResult(meet.value.id, resultId, edited)
    await load()
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function restore(revision: number) {
  if (!meet.value) return
  saving.value = true
  saveError.value = ''
  try {
    await restoreRevision(meet.value.id, resultId, revision)
    await load()
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

/** The scoresheet, opening this revision (R9); saving there sends it to the meet by name */
function scoresheetHref(revision: number): string {
  if (!meet.value) return '#'
  const query = new URLSearchParams({
    meet: String(meet.value.id),
    result: String(resultId),
    revision: String(revision),
  })
  return `${__SCORESHEET_URL__}?${query}`
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

onMounted(load)
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'meet-results', params: { slug } })">
      ← Results
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet && currentFile">
      <h2 class="page-title">{{ quizName(currentFile.quiz) }}: {{ meet.name }}</h2>

      <section class="section">
        <h3 class="section-title">Names</h3>
        <form class="quick-form" @submit.prevent="saveForm">
          <label>
            Division
            <input v-model="form.division" required />
          </label>
          <label>
            Quiz number
            <input v-model="form.quizNumber" required />
          </label>
          <fieldset v-for="team in form.teams" :key="team.id" class="team-fields">
            <legend>Team</legend>
            <input v-model="team.name" required :aria-label="`Team ${team.id} name`" />
            <input
              v-for="quizzer in team.quizzers"
              :key="quizzer.id"
              v-model="quizzer.name"
              class="quizzer-name"
              :aria-label="`Quizzer ${quizzer.id} name`"
            />
          </fieldset>
          <div class="form-actions">
            <button class="btn btn--primary btn--sm" type="submit" :disabled="saving">
              Save names
            </button>
            <a
              v-if="current"
              class="btn btn--secondary btn--sm"
              :href="scoresheetHref(current.revision)"
            >
              Open in scoresheet
            </a>
          </div>
          <p v-if="saveError" class="state-msg state-msg--error">{{ saveError }}</p>
        </form>
      </section>

      <section class="section">
        <h3 class="section-title">History</h3>
        <ol class="history">
          <li v-for="(entry, i) in history" :key="i" class="entry">
            <template v-if="entry.kind === 'revision'">
              <div class="entry-head">
                <strong>Revision {{ entry.revision }}</strong>
                <span>
                  {{ entry.action }} by {{ entry.savedBy.name }}, {{ formatWhen(entry.savedAt) }}
                </span>
                <span v-if="entry.restoredFrom !== undefined" class="note">
                  restores revision {{ entry.restoredFrom }}
                </span>
              </div>
              <div class="entry-teams">
                <span
                  v-for="(team, seat) in teamsByRevision.get(entry.revision)"
                  :key="seat"
                  class="team"
                >
                  {{ team.name }} <strong>{{ team.score }}</strong>
                </span>
              </div>
              <div class="entry-actions">
                <button
                  v-if="!entry.current"
                  class="btn btn--secondary btn--sm"
                  :disabled="saving"
                  @click="restore(entry.revision)"
                >
                  Restore
                </button>
                <a class="btn btn--secondary btn--sm" :href="scoresheetHref(entry.revision)">
                  Open in scoresheet
                </a>
              </div>
            </template>
            <div v-else class="entry-head">
              <strong>{{ entry.counted ? 'Counted' : 'Uncounted' }}</strong>
              <span>by {{ entry.changedBy.name }}, {{ formatWhen(entry.changedAt) }}</span>
            </div>
          </li>
        </ol>
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

.section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-bottom: 1rem;
}

.quick-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 0.8rem;
}

.quick-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-width: 16rem;
}

.quick-form input {
  font: inherit;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
}

.team-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
}

.team-fields legend {
  color: var(--color-text-faint);
}

.quizzer-name {
  max-width: 10rem;
}

.form-actions,
.entry-actions {
  display: flex;
  gap: 0.5rem;
}

.history {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 0.8rem;
}

.entry {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.75rem;
}

.entry-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}

.entry-teams {
  margin: 0.25rem 0 0.5rem;
}

.team {
  margin-right: 0.75rem;
  /* A team's name and score stay together when the row wraps */
  white-space: nowrap;
}

.note {
  color: var(--color-text-faint);
  font-style: italic;
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
  text-decoration: none;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}

.btn--sm {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.btn--primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: var(--color-accent);
}

.btn--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
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
</style>
