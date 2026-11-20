<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import {
  divisionTitle,
  MeetRole,
  quizName,
  scheduleQuizMeta,
  type QuizFile,
  type ScheduleDocument,
  type ScheduleQuiz,
} from '@qzr/shared'
import {
  ChoiceDialog,
  isSaved,
  joinedSession,
  markDuplicates,
  matchOf,
  pickedFiles,
  planUpload,
  roomOfScheduled,
  sendPlanned,
  summaryOf,
  type FileReport,
  type PlannedFile,
} from '@qzr/ui'

import { getSender, uploadResult } from '../api'
import { useRoomCode } from '../composables/useRoomCode'
import { useMeetPage } from '../meetPage'

/**
 * Uploading quiz files or sheets to a meet, in the meet page's header on every tab (FR-007): the
 * files picked are matched to their scheduled quizzes for review, then sent, each reported. Once
 * sent, the header keeps one line for the last batch and any files not sent, which opens the full
 * report, so the tabs below aren't pushed down (spec 011).
 */
// Who sends: the meet's admin, or an official, whose ended guest session is renewed first
const { meet, sender, published, refresh } = useMeetPage()

const { renew } = useRoomCode()
const choiceDialog = ref<InstanceType<typeof ChoiceDialog> | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref('')
/**
 * The last batch sent: its summary, the reports of files saved, which it folds away, and of those
 * skipped or refused. Files not sent are in `notSent`.
 */
const lastBatch = shallowRef<{
  /** Which batch it was, so the files it didn't send are told from earlier ones */
  batch: number
  summary: string
  saved: FileReport[]
  others: FileReport[]
} | null>(null)
/** The report of a file whose send failed, kept across later batches until sent or dismissed */
type NotSentFile = FileReport & { key: number; batch: number }
const notSent = shallowRef<NotSentFile[]>([])
let notSentKeys = 0
let batches = 0
/**
 * The header's line: the last batch's summary, then any files still not sent from earlier batches,
 * which the summary doesn't count
 */
const statusLine = computed(() => {
  const earlier = notSent.value.filter((entry) => entry.batch !== lastBatch.value?.batch).length
  const parts = [lastBatch.value?.summary, earlier > 0 ? `${earlier} not sent earlier` : null]
  return parts.filter((part) => part).join(' · ')
})
/** Whether the report under the header is open; the review opens whenever files are picked */
const reportOpen = ref(false)
/** The files picked, awaiting review before they are sent; empty when none are */
const planned = ref<PlannedFile[]>([])
/** The published schedule the files are matched to, as the page holds it; null when there is none */
const schedule = computed<ScheduleDocument | null>(() => published.value?.document ?? null)
const scheduled = computed<ScheduleQuiz[]>(() => schedule.value?.quizzes ?? [])
const nameOfScheduled = (quiz: ScheduleQuiz) => quizName(scheduleQuizMeta(quiz))

/** Read the picked files and match each to its scheduled quiz, for review before sending */
async function onUploadFiles(event: Event) {
  uploadError.value = ''
  // A new pick starts a new batch: the last one's report would read as this one's. Files not sent
  // stay
  lastBatch.value = null
  reportOpen.value = false
  try {
    planned.value = planUpload(await pickedFiles(event), schedule.value)
  } catch (e) {
    uploadError.value = (e as Error).message
  }
}

/** Send a planned file as the scheduled quiz picked for it in the review, or none */
function pick(item: PlannedFile, scheduleQuizId: string | null) {
  const picked = planned.value.map((p) => (p === item ? { ...p, scheduleQuizId } : p))
  planned.value = markDuplicates(picked, schedule.value)
}

/** How a planned file came to its scheduled quiz, as the review says it */
function matchText(item: PlannedFile): string {
  if (!schedule.value || !item.quizFile) return ''
  const match = matchOf(item, schedule.value)
  if (match === 'name') return 'Matched by name'
  if (match === 'hand') return 'Picked by hand'
  if (match === 'suggestion') return 'Picked from the suggestion'
  return `No scheduled quiz is named ${quizName(item.quizFile.quiz)}`
}

/** A file's division, consolation flag and quiz number, exactly as the file has them */
function readAs({ division, consolation, quizNumber }: QuizFile['quiz']): string {
  return `${divisionTitle(division)}${consolation ? ' consolation' : ''}, quiz ${quizNumber}`
}

const scheduledById = (id: string | null) => scheduled.value.find((q) => q.id === id)

/** The room a planned file goes to, as the review shows it */
function plannedRoom(item: PlannedFile): string {
  if (!sender.value?.admin || !schedule.value) return ''
  // An admin picks a room for any file with no scheduled room, once the upload is sent
  const roomId = item.scheduleQuizId ? roomOfScheduled(schedule.value, item.scheduleQuizId) : null
  return sender.value.rooms.find((room) => room.id === roomId)?.name ?? 'Picked when sent'
}

/** Send the reviewed files, report each, then have the page read the meet again */
async function sendUpload() {
  const reports = await sendFiles(planned.value)
  if (!reports) return
  planned.value = []
  record(reports)
}

/** Send files not sent again, as they were reviewed; any failing again stay in the list */
async function retry(entries: NotSentFile[]) {
  const reports = await sendFiles(entries.map((entry) => entry.item))
  if (!reports) return
  dismissNotSent(entries)
  record(reports)
}

function dismissNotSent(entries: NotSentFile[]) {
  const gone = new Set(entries)
  notSent.value = notSent.value.filter((entry) => !gone.has(entry))
}

/**
 * Show a sent batch's summary and reports, keeping the files not sent for another try. The report
 * opens when something in it wasn't saved, and stays a line in the header when all of it was.
 */
function record(reports: FileReport[]) {
  const failed = reports.filter((report) => report.outcome === 'notSent')
  const others = reports.filter((r) => !isSaved(r.outcome) && r.outcome !== 'notSent')
  lastBatch.value = {
    batch: ++batches,
    summary: summaryOf(reports),
    saved: reports.filter((report) => isSaved(report.outcome)),
    others,
  }
  notSent.value = [
    ...notSent.value,
    ...failed.map((report) => ({ ...report, key: ++notSentKeys, batch: batches })),
  ]
  reportOpen.value = failed.length > 0 || others.length > 0
}

/** Send files to the meet, then have the page read it again; undefined when nothing was sent */
async function sendFiles(files: PlannedFile[]): Promise<FileReport[] | undefined> {
  if (!meet.value) return undefined
  const { id: meetId, name: meetName } = meet.value
  uploading.value = true
  uploadError.value = ''
  try {
    // Renew a guest official's ended session before sending, rather than fail each file; anyone
    // else's sender is the one the page loaded
    if (joinedSession(meetId)?.role === MeetRole.Official) {
      const who = await renew(meetId, () => getSender(meetId))
      if (!who) return undefined
      sender.value = who
    }
    const reports = await sendPlanned(
      files,
      choiceDialog.value,
      sender.value,
      meetName,
      schedule.value,
      (quizFile, roomId, onExisting, scheduleQuizId) =>
        uploadResult(meetId, quizFile, roomId, onExisting, scheduleQuizId),
    )
    if (!reports) return undefined
    // The page reads the meet again, every tab with it
    void refresh()
    return reports
  } catch (e) {
    uploadError.value = (e as Error).message
    return undefined
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="upload">
    <button class="btn btn--primary btn--sm" :disabled="uploading" @click="uploadInput?.click()">
      {{ uploading ? 'Uploading…' : 'Upload quiz files or sheets' }}
    </button>
    <input
      ref="uploadInput"
      type="file"
      accept=".json,application/json,.ods,.ots"
      multiple
      hidden
      @change="onUploadFiles"
    />
    <!-- One line for the last batch and the files not sent, which opens the full report -->
    <button
      v-if="(lastBatch || notSent.length > 0) && planned.length === 0"
      class="upload-status"
      :class="{ 'upload-status--failed': notSent.length > 0 }"
      :aria-expanded="reportOpen"
      @click="reportOpen = !reportOpen"
    >
      {{ statusLine }} {{ reportOpen ? '▴' : '▾' }}
    </button>
  </div>
  <div
    v-if="uploadError || planned.length > 0 || (reportOpen && (lastBatch || notSent.length > 0))"
    class="upload-panel"
  >
    <p v-if="uploadError" class="state-msg state-msg--error">{{ uploadError }}</p>
    <div v-if="planned.length > 0" class="upload-review">
      <table class="results-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Read from the file</th>
            <th>Scheduled quiz</th>
            <th v-if="sender?.admin && schedule">Room</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in planned" :key="item.file" :class="{ refused: !item.quizFile }">
            <td>{{ item.file }}</td>
            <td v-if="!item.quizFile" colspan="3">{{ item.refusal }}</td>
            <template v-else>
              <td>
                {{ readAs(item.quizFile.quiz) }}
                <span v-if="item.duplicate" class="note">another file names this quiz</span>
              </td>
              <td>
                <select
                  :value="item.scheduleQuizId ?? ''"
                  class="stage-select"
                  :aria-label="`Scheduled quiz for ${item.file}`"
                  @change="pick(item, ($event.target as HTMLSelectElement).value || null)"
                >
                  <option value="">
                    {{
                      schedule
                        ? 'None picked: linked by its name, if the schedule has it'
                        : 'No schedule'
                    }}
                  </option>
                  <option v-for="quiz in scheduled" :key="quiz.id" :value="quiz.id">
                    {{ nameOfScheduled(quiz) }}
                  </option>
                </select>
                <span class="note match">{{ matchText(item) }}</span>
                <button
                  v-if="!item.scheduleQuizId && scheduledById(item.suggestion)"
                  class="btn btn--secondary btn--sm"
                  @click="pick(item, item.suggestion)"
                >
                  Use {{ nameOfScheduled(scheduledById(item.suggestion)!) }}
                </button>
              </td>
              <td v-if="sender?.admin && schedule">{{ plannedRoom(item) }}</td>
            </template>
          </tr>
        </tbody>
      </table>
      <div class="downloads">
        <button class="btn btn--primary btn--sm" :disabled="uploading" @click="sendUpload">
          {{
            uploading ? 'Sending…' : `Send ${planned.length} file${planned.length === 1 ? '' : 's'}`
          }}
        </button>
        <button class="btn btn--secondary btn--sm" :disabled="uploading" @click="planned = []">
          Cancel
        </button>
      </div>
    </div>
    <template v-if="planned.length === 0 && reportOpen">
      <div v-if="lastBatch" class="upload-report">
        <p class="batch-summary">{{ lastBatch.summary }}</p>
        <ul v-if="lastBatch.others.length">
          <li v-for="(report, i) in lastBatch.others" :key="i" class="refused">
            {{ report.item.file }}: {{ report.message }}
          </li>
        </ul>
        <details v-if="lastBatch.saved.length">
          <summary>Saved or unchanged ({{ lastBatch.saved.length }})</summary>
          <ul>
            <li v-for="(report, i) in lastBatch.saved" :key="i">
              {{ report.item.file }}: {{ report.message }}
            </li>
          </ul>
        </details>
      </div>
      <div v-if="notSent.length > 0" class="not-sent">
        <p class="batch-summary">Not sent</p>
        <p class="note">
          These files weren't saved. Send them again or dismiss them; leaving this page forgets
          them.
        </p>
        <ul class="upload-report">
          <li v-for="entry in notSent" :key="entry.key" class="refused">
            {{ entry.item.file }}: {{ entry.message }}
            <button
              class="btn btn--secondary btn--sm"
              :disabled="uploading"
              @click="retry([entry])"
            >
              Retry
            </button>
            <button
              class="btn btn--secondary btn--sm"
              :disabled="uploading"
              @click="dismissNotSent([entry])"
            >
              Dismiss
            </button>
          </li>
        </ul>
        <div v-if="notSent.length > 1" class="downloads">
          <button class="btn btn--primary btn--sm" :disabled="uploading" @click="retry(notSent)">
            Retry all
          </button>
          <button
            class="btn btn--secondary btn--sm"
            :disabled="uploading"
            @click="dismissNotSent(notSent)"
          >
            Dismiss all
          </button>
        </div>
      </div>
      <button class="btn btn--secondary btn--sm" @click="reportOpen = false">Close</button>
    </template>
  </div>
  <ChoiceDialog ref="choiceDialog" />
</template>

<style scoped>
/* The upload button and the last batch's line, side by side */
.upload {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

/* The review and the reports open across the page under its header */
.upload-panel {
  flex-basis: 100%;
  margin-top: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-raised);
}

.refused {
  color: var(--palette-error);
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

.downloads {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 0.5rem 0;
}

.upload-report {
  margin: 0.5rem 0;
  font-size: 0.8rem;
}

ul.upload-report,
.upload-report ul {
  padding-left: 1.25rem;
}

.upload-report li .btn {
  margin-left: 0.3rem;
}

.batch-summary {
  font-weight: 600;
}

.match {
  display: block;
}

/* The last batch in one line beside the upload button, opening its report */
.upload-status {
  font: inherit;
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  cursor: pointer;
}

.upload-status--failed {
  border-color: var(--palette-error);
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

.note {
  color: var(--color-text-faint);
  font-style: italic;
}
</style>
