<script setup lang="ts">
import { scoresheetLink } from '../scoresheetLink'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ApiError,
  deserialize,
  quizName,
  quizOutcome,
  type QuizFile,
  bareDivision,
  findDivision,
} from '@qzr/shared'
import { formatWhen, DivisionInput } from '@qzr/ui'

import {
  editResult,
  isStaleSave,
  getHistory,
  getMeet,
  getSender,
  listResults,
  restoreRevision,
  setAcceptance,
  type HistoryEntry,
  type MeetDetail,
  type StoredQuiz,
} from '../api'
import { editQuizFile, keepEdits, type NamesForm } from '../results'
import { changeText, problemText } from '../stats'
import { useRoomCode } from '../composables/useRoomCode'

const props = defineProps<{ slug: string; resultId: string }>()
const router = useRouter()
const resultId = Number(props.resultId)
const { renew } = useRoomCode()

const meet = ref<MeetDetail['meet'] | null>(null)
const history = ref<HistoryEntry[]>([])
/** The quiz as the results list has it: what is wrong with it, and whether it is accepted */
const listed = ref<StoredQuiz | null>(null)
const isAdmin = ref(false)
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
const form = ref<NamesForm>({ division: '', quizNumber: '', teams: [] })

/** Seat columns in the names grid: the most quizzers any team has */
// At least one column, so the grid's template stays valid for a quiz with no seats listed
const seatCount = computed(() => Math.max(1, ...form.value.teams.map((t) => t.quizzers.length)))

/**
 * The form as last filled from a revision, and that revision. The save names it as its base, so the
 * API refuses a save made from an older revision instead of letting it undo a newer one.
 */
const filledForm = ref<NamesForm>({ division: '', quizNumber: '', teams: [] })
const formBase = ref<number | null>(null)

function namesOf(file: QuizFile): NamesForm {
  return {
    division: file.quiz.division,
    quizNumber: file.quiz.quizNumber,
    teams: file.teams.map((team) => ({
      id: team.id,
      name: team.name,
      quizzers: team.quizzers.map((q) => ({ id: q.id, name: q.name })),
    })),
  }
}

function fillForm(file: QuizFile, revision: number) {
  filledForm.value = namesOf(file)
  form.value = namesOf(file)
  formBase.value = revision
}

/**
 * Load the quiz and its history, and fill the names form from the newest revision. `quiet` refreshes
 * the page in place: no loading state, and a failure is returned rather than shown in place of the
 * page, so whatever the user typed stays on screen. Null when it loaded.
 */
async function load({ quiet = false } = {}): Promise<string | null> {
  if (!quiet) loading.value = true
  error.value = ''
  try {
    // A guest official's slug is the meet's id; their ended session is renewed on opening the page
    const loaded = await renew(Number(props.slug), async () => {
      const { meet: detail } = await getMeet(props.slug)
      const [entries, quizzes, who] = await Promise.all([
        getHistory(detail.id, resultId),
        listResults(detail.id),
        getSender(detail.id),
      ])
      return { detail, history: entries, quizzes, who }
    })
    if (!loaded) return failed('Join the meet again with your room code to see this quiz.')
    meet.value = loaded.detail
    history.value = loaded.history
    listed.value = loaded.quizzes.find((quiz) => quiz.id === resultId) ?? null
    isAdmin.value = loaded.who.admin
    if (current.value) fillForm(current.value.quizFile, current.value.revision)
    return null
  } catch (e) {
    return failed(
      e instanceof ApiError && e.status === 401
        ? 'Join the meet again with your room code to see this quiz.'
        : e instanceof ApiError && e.status === 403
          ? "Only the meet's admins and this quiz's room officials can see it."
          : (e as Error).message,
    )
  } finally {
    loading.value = false
  }

  function failed(message: string): string {
    if (!quiet) error.value = message
    return message
  }
}

/**
 * The division a typed name is, spelled as the meet spells it, so a quiz renamed to `2c` in a meet
 * whose division is `2C` keeps the name its other quizzes are stored under
 */
function meetDivisionOf(typed: string): string {
  return findDivision(meet.value?.divisions ?? [], typed) ?? typed
}

/** Save the quick form's names as a new revision, made from the revision the form was filled from */
async function saveForm() {
  const base = history.value.find(
    (entry): entry is Save => entry.kind === 'revision' && entry.revision === formBase.value,
  )
  if (!meet.value || !base) return
  saving.value = true
  saveError.value = ''
  try {
    const edited = editQuizFile(base.quizFile, {
      // A division left as it was keeps its spelling, so editing a name never moves the quiz
      division:
        form.value.division === base.quizFile.quiz.division
          ? form.value.division
          : meetDivisionOf(bareDivision(form.value.division)),
      quizNumber: form.value.quizNumber,
      teamNames: new Map(form.value.teams.map((team) => [team.id, team.name])),
      quizzerNames: new Map(
        form.value.teams.flatMap((team) => team.quizzers.map((q) => [q.id, q.name] as const)),
      ),
    })
    const meetId = meet.value.id
    const saved = await renew(
      meetId,
      () => editResult(meetId, resultId, edited, { baseRevision: base.revision }),
      { sameRoom: true },
    )
    if (!saved) return
    await load()
  } catch (e) {
    if (isStaleSave(e)) await carryEditsForward()
    else saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

/**
 * After a save refused as stale (a correction sent from the scoresheet's tab, say): bring the page
 * up to date, and keep the names the user changed, for them to save onto the newest revision
 */
async function carryEditsForward() {
  const was = filledForm.value
  const typed = form.value
  const failed = await load({ quiet: true })
  if (failed) {
    // The page and the typed names stay as they were; saving again retries, and is refused again
    // until the newest revision can be loaded
    saveError.value =
      `This quiz was changed somewhere else since this page loaded, and the latest version ` +
      `couldn't be loaded (${failed}). Your changes are still here: try saving again.`
    return
  }
  form.value = keepEdits(filledForm.value, was, typed)
  saveError.value =
    'This quiz was changed somewhere else since this page loaded, so the page has been brought ' +
    'up to date. Your changes are kept where they still apply: check them and save again.'
}

async function restore(revision: number) {
  if (!meet.value) return
  saving.value = true
  saveError.value = ''
  try {
    const meetId = meet.value.id
    if (
      !(await renew(meetId, () => restoreRevision(meetId, resultId, revision), {
        sameRoom: true,
      }))
    )
      return
    await load()
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

/** Accept the quiz as scored at its current revision, or withdraw that */
async function accept(accepted: boolean) {
  if (!meet.value || !listed.value) return
  saving.value = true
  saveError.value = ''
  try {
    await setAcceptance(meet.value.id, resultId, listed.value.revision, accepted)
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
    meetId: String(meet.value.id),
    result: String(resultId),
    revision: String(revision),
  })
  return `${__SCORESHEET_URL__}?${query}`
}

onMounted(() => void load())
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

      <section v-if="listed?.problems?.length" class="section">
        <h3 class="section-title">
          {{ listed.accepted ? 'Accepted as scored, with these errors' : 'Errors' }}
        </h3>
        <ul class="problems">
          <li v-for="(problem, i) in listed.problems" :key="i">{{ problemText(problem) }}</li>
        </ul>
        <p v-if="!listed.accepted" class="state-msg">
          It adds nothing to the standings until these are fixed or an admin accepts it as scored.
        </p>
        <button
          v-if="isAdmin"
          class="btn btn--secondary btn--sm"
          :disabled="saving"
          @click="accept(!listed.accepted)"
        >
          {{ listed.accepted ? 'Withdraw acceptance' : 'Accept as scored' }}
        </button>
      </section>

      <section class="section">
        <h3 class="section-title">Names</h3>
        <form class="quick-form" @submit.prevent="saveForm">
          <div class="quiz-fields">
            <label class="division-field">
              Division
              <!-- Its label says "Division", so the box shows no prefix of its own -->
              <DivisionInput v-model="form.division" bare required />
            </label>
            <label class="quiz-number-field">
              Quiz number
              <input v-model="form.quizNumber" required />
            </label>
          </div>
          <!-- One row per team, its seats in columns, so the names line up across teams -->
          <div class="names-grid" :style="{ '--seats': seatCount }">
            <span class="names-grid-head" aria-hidden="true">Team</span>
            <span
              v-for="n in seatCount"
              :key="`seat${n}`"
              class="names-grid-head"
              aria-hidden="true"
            >
              Seat {{ n }}
            </span>
            <template v-for="team in form.teams" :key="team.id">
              <input
                v-model="team.name"
                class="team-name"
                required
                :aria-label="`Team ${team.id} name`"
              />
              <input
                v-for="quizzer in team.quizzers"
                :key="quizzer.id"
                v-model="quizzer.name"
                placeholder="Empty seat"
                :aria-label="`Quizzer ${quizzer.id} name`"
              />
            </template>
          </div>
          <div class="form-actions">
            <button class="btn btn--primary btn--sm" type="submit" :disabled="saving">
              Save names
            </button>
            <a
              v-if="current"
              class="btn btn--secondary btn--sm"
              :href="scoresheetHref(current.revision)"
              v-bind="scoresheetLink"
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
                <a
                  class="btn btn--secondary btn--sm"
                  :href="scoresheetHref(entry.revision)"
                  v-bind="scoresheetLink"
                >
                  Open in scoresheet
                </a>
              </div>
            </template>
            <div v-else class="entry-head">
              <strong v-if="entry.kind === 'counting'">
                {{ entry.counted ? 'Counted' : 'Uncounted' }}
              </strong>
              <strong v-else>{{ changeText(entry) }}</strong>
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

.problems {
  margin: 0 0 0.6rem;
  padding-left: 1.1rem;
  font-size: 0.85rem;
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
}

.quiz-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.division-field {
  width: 10rem;
}

.quiz-number-field {
  width: 6rem;
}

.quick-form input {
  font: inherit;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
}

.names-grid {
  display: grid;
  grid-template-columns: minmax(9rem, 1.4fr) repeat(var(--seats), minmax(0, 1fr));
  gap: 0.4rem 0.5rem;
  align-items: center;
}

.names-grid input {
  min-width: 0;
}

.names-grid-head {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-faint);
}

.team-name {
  /* Each team starts its own row, however many seats the one before it filled */
  grid-column: 1;
  font-weight: 600;
}

/* On a phone each team stacks: its name across the top, its seats two to a row */
@media (max-width: 640px) {
  .names-grid {
    grid-template-columns: 1fr 1fr;
  }

  .names-grid-head {
    display: none;
  }

  .team-name {
    grid-column: 1 / -1;
    margin-top: 0.5rem;
  }
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
