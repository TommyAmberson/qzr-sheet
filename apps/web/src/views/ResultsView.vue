<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import {
  ApiError,
  divisionStandings,
  type StandingsWarning,
  type TeamStanding,
  type TieBreak,
} from '@qzr/shared'
import { ChoiceDialog, formatSlotTime, uploadPicked, type FileReport, type Sender } from '@qzr/ui'

import {
  editResult,
  getMeet,
  getSender,
  listResults,
  setResultsCounted,
  uploadResult,
  type MeetDetail,
  type StoredQuiz,
} from '../api'
import { countedQuizzes, groupResults, mergeEdits, type ResultRow } from '../results'

const props = defineProps<{ slug: string }>()
const router = useRouter()

const meet = ref<MeetDetail['meet'] | null>(null)
/** The meet's stored quizzes as listed: replaced whole, never changed in place */
const stored = shallowRef<StoredQuiz[]>([])
const divisions = computed(() => groupResults(stored.value))
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const countError = ref('')
/** Who the user is in this meet: an admin counts quizzes and reads the standings; an official doesn't */
const sender = ref<Sender | null>(null)
const isAdmin = computed(() => sender.value?.admin ?? false)
const choiceDialog = ref<InstanceType<typeof ChoiceDialog> | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadReports = ref<FileReport[]>([])
const uploadError = ref('')
const merging = ref(false)
const mergeError = ref('')

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
    const [quizzes, who] = await Promise.all([listResults(detail.id), senderOf(detail.id)])
    sender.value = who
    stored.value = quizzes
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 401
        ? 'Join the meet again with your room code to see its results.'
        : e instanceof ApiError && e.status === 403
          ? "Only the meet's admins and officials can see its results."
          : (e as Error).message
  } finally {
    loading.value = false
  }
}

/** Who the user is when sending to this meet, as the API works it out; null for anyone else */
async function senderOf(meetId: number): Promise<Sender | null> {
  try {
    return await getSender(meetId)
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null
    throw e
  }
}

/** Upload the picked saved quiz files, report each, then show the list as it is now */
async function onUploadFiles(event: Event) {
  if (!meet.value) return
  const meetId = meet.value.id
  uploading.value = true
  uploadError.value = ''
  try {
    const reports = await uploadPicked(
      event,
      choiceDialog.value,
      sender.value,
      meet.value.name,
      (quizFile, roomId, onExisting) => uploadResult(meetId, quizFile, roomId, onExisting),
    )
    if (!reports) return
    uploadReports.value = reports
    stored.value = await listResults(meetId)
  } catch (e) {
    uploadError.value = (e as Error).message
  } finally {
    uploading.value = false
  }
}

/**
 * Count or uncount quizzes, showing the change at once and undoing it if the server refuses. Once
 * it succeeds every quiz sent has that value, whichever of them actually changed.
 */
async function setCounted(quizzes: ResultRow[], counted: boolean) {
  if (!meet.value || quizzes.length === 0) return
  const before = stored.value
  const ids = new Set(quizzes.map((quiz) => quiz.id))
  stored.value = before.map((quiz) => (ids.has(quiz.id) ? { ...quiz, counted } : quiz))
  saving.value = true
  countError.value = ''
  try {
    await setResultsCounted(meet.value.id, [...ids], counted)
  } catch (e) {
    stored.value = before
    countError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

/**
 * Merge two look-alike team names in a division, keeping the one the admin picks: each quiz of the
 * division using the other is saved with the kept name as a `merged` revision, one at a time (R10).
 * A failure part-way leaves the rest unmerged and still flagged, so merging again finishes it.
 */
async function mergeNames(division: string, names: [string, string], teams: TeamStanding[]) {
  if (!meet.value) return
  const meetId = meet.value.id
  const quizzesOf = (name: string) => teams.find((team) => team.name === name)?.quizzes ?? 0
  const [first, second] = names
  const into = await choiceDialog.value?.ask(
    `Merge ${first} and ${second}?`,
    `Every quiz in division ${division} using one name is saved with the other, as a new revision.`,
    [
      { label: 'Cancel', value: null },
      { label: `Keep ${first}`, value: first, primary: quizzesOf(first) >= quizzesOf(second) },
      { label: `Keep ${second}`, value: second, primary: quizzesOf(second) > quizzesOf(first) },
    ],
  )
  if (!into) return
  const edits = mergeEdits(stored.value, division, into === first ? second : first, into)
  merging.value = true
  mergeError.value = ''
  let done = 0
  try {
    for (const { id, quizFile } of edits) {
      await editResult(meetId, id, quizFile, 'merged')
      done += 1
    }
  } catch (e) {
    mergeError.value = `Merged ${done} of ${edits.length} quizzes: ${(e as Error).message} Merge again to finish.`
  } finally {
    try {
      stored.value = await listResults(meetId)
    } catch (e) {
      mergeError.value ||= (e as Error).message
    }
    merging.value = false
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
    case 'lookAlike':
      return `${warning.teams[0]} and ${warning.teams[1]} look like one team spelt two ways.`
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

      <div v-if="sender" class="upload">
        <button
          class="btn btn--secondary btn--sm"
          :disabled="uploading"
          @click="uploadInput?.click()"
        >
          {{ uploading ? 'Uploading…' : 'Upload saved quiz files' }}
        </button>
        <input
          ref="uploadInput"
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          @change="onUploadFiles"
        />
        <p v-if="uploadError" class="state-msg state-msg--error">{{ uploadError }}</p>
        <ul v-if="uploadReports.length > 0" class="upload-report">
          <li
            v-for="report in uploadReports"
            :key="report.file"
            :class="{ refused: !report.stored }"
          >
            {{ report.file }}: {{ report.message }}
          </li>
        </ul>
      </div>

      <p v-if="divisions.length === 0" class="state-msg">No quizzes submitted yet.</p>

      <template v-else-if="isAdmin">
        <h3 class="section-title">Standings</h3>
        <p v-if="mergeError" class="state-msg state-msg--error">{{ mergeError }}</p>
        <p v-if="standings.length === 0" class="state-msg">
          Count quizzes below, normally the prelims, to see each division's standings.
        </p>
        <section v-for="division in standings" :key="division.division" class="division">
          <h4 class="division-title">Division {{ division.division }}</h4>
          <table v-if="division.teams.length > 0" class="results-table">
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
              <button
                v-if="warning.kind === 'lookAlike'"
                class="btn btn--secondary btn--sm"
                :disabled="merging"
                @click="mergeNames(division.division, warning.teams, division.teams)"
              >
                Merge
              </button>
            </li>
          </ul>
        </section>
      </template>

      <template v-if="divisions.length > 0">
        <div class="quizzes-header">
          <h3 class="section-title">Quizzes</h3>
          <button
            v-if="isAdmin"
            class="btn btn--secondary btn--sm"
            :disabled="saving"
            @click="setCounted(allQuizzes, true)"
          >
            Count all
          </button>
          <button
            v-if="isAdmin"
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
        <table class="results-table quiz-table">
          <thead>
            <tr>
              <th>Quiz</th>
              <th>Teams</th>
              <th>From</th>
              <th>Revision</th>
              <th>Last saved</th>
              <th v-if="isAdmin">Counted</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="quiz in group.quizzes" :key="quiz.id">
              <td class="cell-quiz">
                <router-link :to="{ name: 'meet-result', params: { slug, resultId: quiz.id } }">
                  {{ quiz.name }}
                </router-link>
              </td>
              <td class="cell-teams">
                <ul class="teams">
                  <li v-for="(team, seat) in quiz.teams" :key="seat">
                    {{ team.name }} <strong>{{ team.score }}</strong>
                    <span v-if="team.place !== null" class="note">
                      {{ placeLabel(team.place) }}, {{ team.placementPoints }} pts
                    </span>
                  </li>
                  <li v-if="!quiz.placed" class="note">not placed yet</li>
                </ul>
              </td>
              <td class="cell-from" data-label="From">{{ quiz.from }}</td>
              <td class="cell-revision" data-label="Revision">{{ quiz.revision }}</td>
              <td class="cell-saved" data-label="Last saved">
                {{ quiz.savedBy }}, {{ quiz.action }}, {{ formatSlotTime(quiz.savedAt) }}
              </td>
              <td v-if="isAdmin" class="cell-counted" data-label="Counted">
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
    <ChoiceDialog ref="choiceDialog" />
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

.teams {
  list-style: none;
  padding: 0;
  margin: 0;
}

/* Vue drops the line break between a team's score and its place, so space them here */
.teams li > .note {
  margin-left: 0.3rem;
}

/* On a phone each quiz is a card: its name and Counted box, its teams, then the rest, labelled */
@media (max-width: 640px) {
  .quiz-table thead {
    display: none;
  }

  .quiz-table tbody {
    display: block;
  }

  .quiz-table tbody tr {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'quiz counted'
      'teams teams'
      'from from'
      'revision revision'
      'saved saved';
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--color-border);
  }

  .quiz-table tbody td {
    border: none;
    padding: 0.15rem 0;
  }

  .quiz-table td[data-label]::before {
    content: attr(data-label) ' ';
    color: var(--color-text-faint);
  }

  .cell-quiz {
    grid-area: quiz;
    font-weight: 600;
  }

  .cell-counted {
    grid-area: counted;
  }

  .cell-teams {
    grid-area: teams;
  }

  .cell-from {
    grid-area: from;
  }

  .cell-revision {
    grid-area: revision;
  }

  .cell-saved {
    grid-area: saved;
  }
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

.upload {
  margin-bottom: 1.5rem;
}

.upload-report {
  margin-top: 0.5rem;
  padding-left: 1.25rem;
  font-size: 0.8rem;
}

.upload-report .refused {
  color: var(--palette-error);
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

.warnings button {
  margin-left: 0.5rem;
}

.note {
  color: var(--color-text-faint);
  font-style: italic;
}
</style>
