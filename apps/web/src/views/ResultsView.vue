<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import {
  ApiError,
  foldName,
  MeetRole,
  placeRank,
  placeTieCount,
  STAGE_CHOICES,
  scheduleQuizMeta,
  quizName,
  type DivisionStats,
  type ScheduleQuiz,
  type StageChoice,
  mayChangeQuizzes,
  divisionTitle,
} from '@qzr/shared'
import {
  ChoiceDialog,
  formatSlotTime,
  joinedSession,
  uploadPicked,
  type FileReport,
  type Sender,
} from '@qzr/ui'

import {
  editResult,
  getDivisionStats,
  getMeet,
  getPublishedSchedule,
  getSender,
  linkResult,
  listResults,
  setAcceptance,
  setResultsStage,
  uploadResult,
  type MeetDetail,
  type StoredQuiz,
} from '../api'
import { groupResults, mergeEdits, type ResultRow } from '../results'
import { STAGE_LABELS, placeLabel, problemText, warningText } from '../stats'
import { useRoomCode } from '../composables/useRoomCode'

const props = defineProps<{ slug: string }>()
const router = useRouter()

const meet = ref<MeetDetail['meet'] | null>(null)
/** The meet's stored quizzes as listed: replaced whole, never changed in place */
const stored = shallowRef<StoredQuiz[]>([])
const divisions = computed(() => groupResults(stored.value))
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const changeError = ref('')
/** The published schedule's quizzes, which stored quizzes are linked to; none when there is no schedule */
const scheduled = shallowRef<ScheduleQuiz[]>([])
/** Who the user is in this meet: an admin counts quizzes and reads the standings; an official doesn't */
const sender = ref<Sender | null>(null)
const isAdmin = computed(() => sender.value?.admin ?? false)
const choiceDialog = ref<InstanceType<typeof ChoiceDialog> | null>(null)
const { renew } = useRoomCode()
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadReports = ref<FileReport[]>([])
const uploadError = ref('')
const merging = ref(false)
const mergeError = ref('')

/** Each division's stats as the API works them out, for its warnings and the link to its page */
const divisionStats = ref<DivisionStats[]>([])
const statsError = ref('')
const allQuizzes = computed(() => divisions.value.flatMap((group) => group.quizzes))

async function load() {
  loading.value = true
  error.value = ''
  try {
    // A guest official's slug is the meet's id; their ended session is renewed on opening the page
    const loaded = await renew(Number(props.slug), async () => {
      const { meet: detail } = await getMeet(props.slug)
      const [quizzes, who] = await Promise.all([listResults(detail.id), senderOf(detail.id)])
      return { detail, quizzes, who }
    })
    if (!loaded) {
      error.value = 'Join the meet again with your room code to see its results.'
      return
    }
    meet.value = loaded.detail
    sender.value = loaded.who
    stored.value = loaded.quizzes
    void loadStats()
    void loadSchedule()
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

/** The newest read of the stats; an older one still waiting on the API must not overwrite it */
let statsRead = 0

/** An admin's view of each division with stored quizzes, read again after anything changes them */
async function loadStats() {
  if (!meet.value || !isAdmin.value) return
  const meetId = meet.value.id
  const read = ++statsRead
  // One request for each division, however the quiz files case its name; a quiz with no division
  // belongs to none
  const names = new Map<string, string>()
  for (const { division } of divisions.value) {
    const key = foldName(division)
    if (key !== '' && !names.has(key)) names.set(key, division)
  }
  // A division that can't be read must not hide the others
  const answers = await Promise.all(
    [...names.values()].map((division) =>
      getDivisionStats(meetId, division).catch((e: unknown) => e as Error),
    ),
  )
  if (read !== statsRead) return
  divisionStats.value = answers.filter(
    (answer): answer is DivisionStats => !(answer instanceof Error),
  )
  const failed = answers.find((answer): answer is Error => answer instanceof Error)
  statsError.value = failed ? `Stats could not be read: ${failed.message}` : ''
  // The list shows no problems for a quiz whose score was still to be made when it was read;
  // reading the stats has made those scores, so read the list again to show them
  if (!failed && stored.value.some((quiz) => quiz.problems === null)) {
    try {
      const quizzes = await listResults(meetId)
      if (read === statsRead) stored.value = quizzes
    } catch (e) {
      statsError.value = (e as Error).message
    }
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
    // Renew a guest official's ended session before sending, rather than fail each file; anyone
    // else's sender is the one the page loaded
    if (joinedSession(meetId)?.role === MeetRole.Official) {
      const who = await renew(meetId, () => getSender(meetId))
      if (!who) return
      sender.value = who
    }
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
    void loadStats()
  } catch (e) {
    uploadError.value = (e as Error).message
  } finally {
    // Cleared however it ended, so picking the same files again fires a change
    ;(event.target as HTMLInputElement).value = ''
    uploading.value = false
  }
}

/** The schedule's quizzes to link to; a meet with no published schedule has none */
async function loadSchedule() {
  if (!meet.value) return
  try {
    scheduled.value = (await getPublishedSchedule(meet.value.id)).document.quizzes
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) changeError.value = (e as Error).message
  }
}

const nameOfScheduled = (quiz: ScheduleQuiz) => quizName(scheduleQuizMeta(quiz))
/** The scheduled quiz a stored quiz is linked to, by name */
function linkLabel(quiz: ResultRow): string {
  const linked = scheduled.value.find((q) => q.id === quiz.link?.scheduleQuizId)
  return linked ? nameOfScheduled(linked) : 'a scheduled quiz'
}
/** Whether the user may change links now, by the rule the API refuses changes with */
const canLink = computed(
  () => !!meet.value?.phase && mayChangeQuizzes(meet.value.phase, isAdmin.value),
)

/** The quizzes in error that no admin has accepted, which "Accept all" would accept */
const unaccepted = computed(() =>
  allQuizzes.value.filter((quiz) => quiz.problems?.length && !quiz.accepted),
)

/** Make a change to stored quizzes, then show the list and the stats as they now are */
async function change(action: (meetId: number) => Promise<unknown>) {
  if (!meet.value) return
  const meetId = meet.value.id
  saving.value = true
  changeError.value = ''
  try {
    await action(meetId)
  } catch (e) {
    changeError.value = (e as Error).message
  } finally {
    try {
      stored.value = await listResults(meetId)
      void loadStats()
    } catch (e) {
      changeError.value ||= (e as Error).message
    }
    saving.value = false
  }
}

/** Set what quizzes count for; the empty choice leaves each to the schedule */
function setStage(quizzes: ResultRow[], choice: string) {
  if (quizzes.length === 0) return
  const stage = choice === '' ? null : (choice as StageChoice)
  return change((meetId) =>
    setResultsStage(
      meetId,
      quizzes.map((quiz) => quiz.id),
      stage,
    ),
  )
}

/** The stage picked for every quiz shown; the select then shows its prompt again */
function setEveryStage(event: Event) {
  const select = event.target as HTMLSelectElement
  void setStage(allQuizzes.value, select.value)
  select.selectedIndex = 0
}

function link(quiz: ResultRow, scheduleQuizId: string | null) {
  return change((meetId) => linkResult(meetId, quiz.id, scheduleQuizId))
}

/** Accept quizzes as scored, each at the revision shown, or withdraw one's acceptance */
function accept(quizzes: ResultRow[], accepted: boolean) {
  return change(async (meetId) => {
    await Promise.all(
      quizzes.map((quiz) => setAcceptance(meetId, quiz.id, quiz.revision, accepted)),
    )
  })
}

/**
 * Merge two look-alike team names in a division, keeping the one the admin picks: each quiz of the
 * division using the other is saved with the kept name as a `merged` revision, one at a time (R10).
 * A failure part-way leaves the rest unmerged and still flagged, so merging again finishes it.
 */
async function mergeNames(
  division: string,
  names: [string, string],
  teams: { name: string; quizzes: number }[],
) {
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
      if (
        !(await renew(meetId, () => editResult(meetId, id, quizFile, 'merged'), { sameRoom: true }))
      )
        break
      done += 1
    }
    if (done < edits.length && !mergeError.value) {
      mergeError.value = `Merged ${done} of ${edits.length} quizzes. Merge again to finish.`
    }
  } catch (e) {
    mergeError.value = `Merged ${done} of ${edits.length} quizzes: ${(e as Error).message} Merge again to finish.`
  } finally {
    try {
      stored.value = await listResults(meetId)
      void loadStats()
    } catch (e) {
      mergeError.value ||= (e as Error).message
    }
    merging.value = false
  }
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
        <h3 class="section-title">Stats</h3>
        <p v-if="mergeError" class="state-msg state-msg--error">{{ mergeError }}</p>
        <p v-if="statsError" class="state-msg state-msg--error">{{ statsError }}</p>
        <section v-for="division in divisionStats" :key="division.division" class="division">
          <h4 class="division-title">
            <router-link
              :to="{ name: 'meet-division-stats', params: { slug, division: division.division } }"
            >
              {{ divisionTitle(division.division) }} stats
            </router-link>
          </h4>
          <ul v-if="division.warnings?.length" class="warnings">
            <li v-for="(warning, i) in division.warnings" :key="i">
              {{ warningText(warning) }}
              <button
                v-if="warning.kind === 'lookAlikeTeams'"
                class="btn btn--secondary btn--sm"
                :disabled="merging"
                @click="
                  mergeNames(
                    division.division,
                    warning.names,
                    division.prelimStandings?.teams ?? [],
                  )
                "
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
          <select
            v-if="isAdmin"
            class="stage-select"
            :disabled="saving"
            aria-label="Set the stage of every quiz shown"
            @change="setEveryStage"
          >
            <option disabled selected>Set every stage to…</option>
            <option value="">From the schedule</option>
            <option v-for="choice in STAGE_CHOICES" :key="choice" :value="choice">
              {{ STAGE_LABELS[choice] }}
            </option>
          </select>
          <button
            v-if="isAdmin && unaccepted.length > 0"
            class="btn btn--secondary btn--sm"
            :disabled="saving"
            @click="accept(unaccepted, true)"
          >
            Accept all {{ unaccepted.length }} with errors as scored
          </button>
        </div>
        <p v-if="changeError" class="state-msg state-msg--error">{{ changeError }}</p>
      </template>

      <section v-for="group in divisions" :key="group.division" class="division">
        <!-- As saved, so a quiz whose division is spelled another way stands out in its own group -->
        <h3 class="division-title">Division: {{ group.division || 'none' }}</h3>
        <table class="results-table quiz-table">
          <thead>
            <tr>
              <th>Quiz</th>
              <th>Teams</th>
              <th>From</th>
              <th>Revision</th>
              <th>Last saved</th>
              <th>Stage and link</th>
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
                      {{ placeLabel(placeRank(team.place), placeTieCount(team.place)) }},
                      {{ team.placementPoints }} pts
                    </span>
                  </li>
                  <li v-if="!quiz.placed" class="note">not placed yet</li>
                  <li v-for="(problem, i) in quiz.problems ?? []" :key="`p${i}`" class="problem">
                    {{ problemText(problem) }}
                  </li>
                  <li v-if="quiz.problems?.length && quiz.accepted" class="note">
                    accepted as scored
                  </li>
                </ul>
                <button
                  v-if="isAdmin && quiz.problems?.length"
                  class="btn btn--secondary btn--sm"
                  :disabled="saving"
                  @click="accept([quiz], !quiz.accepted)"
                >
                  {{ quiz.accepted ? 'Withdraw acceptance' : 'Accept as scored' }}
                </button>
              </td>
              <td class="cell-from" data-label="From">{{ quiz.from }}</td>
              <td class="cell-revision" data-label="Revision">{{ quiz.revision }}</td>
              <td class="cell-saved" data-label="Last saved">
                {{ quiz.savedBy }}, {{ quiz.action }}, {{ formatSlotTime(quiz.savedAt) }}
              </td>
              <td class="cell-stage" data-label="Stage">
                <select
                  v-if="isAdmin"
                  class="stage-select"
                  :value="quiz.stageFrom === 'admin' ? (quiz.stage ?? 'notCounted') : ''"
                  :disabled="saving"
                  :aria-label="`Stage of ${quiz.name}`"
                  @change="setStage([quiz], ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">
                    {{
                      quiz.stageFrom === 'admin' || !quiz.stage
                        ? 'From the schedule'
                        : `${STAGE_LABELS[quiz.stage]}, from the ${quiz.stageFrom === 'counted' ? 'old count' : 'schedule'}`
                    }}
                  </option>
                  <option v-for="choice in STAGE_CHOICES" :key="choice" :value="choice">
                    {{ STAGE_LABELS[choice] }}
                  </option>
                </select>
                <span v-else>{{ quiz.stage ? STAGE_LABELS[quiz.stage] : 'Not counted' }}</span>
                <div class="link">
                  <template v-if="quiz.link">
                    Linked to {{ linkLabel(quiz) }}
                    <button
                      v-if="canLink"
                      class="btn btn--secondary btn--sm"
                      :disabled="saving"
                      @click="link(quiz, null)"
                    >
                      Unlink
                    </button>
                  </template>
                  <template v-else>
                    <span class="note">not linked</span>
                    <select
                      v-if="canLink && scheduled.length > 0"
                      class="stage-select"
                      :disabled="saving"
                      :aria-label="`Link ${quiz.name} to a scheduled quiz`"
                      @change="link(quiz, ($event.target as HTMLSelectElement).value)"
                    >
                      <option disabled selected>Link to…</option>
                      <option v-for="q in scheduled" :key="q.id" :value="q.id">
                        {{ nameOfScheduled(q) }}
                      </option>
                    </select>
                  </template>
                </div>
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

/* On a phone each quiz is a card: its name, its teams, then the rest, labelled */
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
      'quiz quiz'
      'teams teams'
      'stage stage'
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

  .cell-stage {
    grid-area: stage;
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

.warnings {
  margin-top: 0.5rem;
  padding-left: 1.25rem;
  font-size: 0.8rem;
  color: var(--palette-error);
}

.warnings button {
  margin-left: 0.5rem;
}

.problem {
  color: var(--palette-error);
}

/* Outlined like the small buttons beside it */
.stage-select {
  font: inherit;
  font-size: 0.75rem;
  max-width: 100%;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  cursor: pointer;
}

.stage-select:hover:not(:disabled),
.stage-select:focus-visible {
  border-color: var(--color-text-muted);
  color: var(--color-text);
  outline: none;
}

.link {
  margin-top: 0.3rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}

.note {
  color: var(--color-text-faint);
  font-style: italic;
}
</style>
