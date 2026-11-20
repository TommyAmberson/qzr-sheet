<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  MeetRole,
  quizName,
  scheduleQuizMeta,
  type ScheduleDocument,
  type ScheduleQuiz,
} from '@qzr/shared'
import {
  ChoiceDialog,
  joinedSession,
  markDuplicates,
  pickedFiles,
  planUpload,
  roomOfScheduled,
  sendPlanned,
  type FileReport,
  type PlannedFile,
} from '@qzr/ui'

import { getSender, uploadResult } from '../api'
import { useRoomCode } from '../composables/useRoomCode'
import { useMeetPage } from '../meetPage'

/**
 * Uploading quiz files or sheets to a meet, in the meet page's header on every tab (FR-007): the
 * files picked are matched to their scheduled quizzes for review, then sent, each reported.
 */
// Who sends: the meet's admin, or an official, whose ended guest session is renewed first
const { meet, sender, published, refresh } = useMeetPage()

const { renew } = useRoomCode()
const choiceDialog = ref<InstanceType<typeof ChoiceDialog> | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref('')
const uploadReports = ref<FileReport[]>([])
/** The files picked, awaiting review before they are sent; empty when none are */
const planned = ref<PlannedFile[]>([])
/** The published schedule the files are matched to, as the page holds it; null when there is none */
const schedule = computed<ScheduleDocument | null>(() => published.value?.document ?? null)
const scheduled = computed<ScheduleQuiz[]>(() => schedule.value?.quizzes ?? [])
const nameOfScheduled = (quiz: ScheduleQuiz) => quizName(scheduleQuizMeta(quiz))

/** Read the picked files and match each to its scheduled quiz, for review before sending */
async function onUploadFiles(event: Event) {
  uploadError.value = ''
  uploadReports.value = []
  try {
    planned.value = planUpload(await pickedFiles(event), schedule.value)
  } catch (e) {
    uploadError.value = (e as Error).message
  }
}

/** The room a planned file goes to, as the review shows it */
function plannedRoom(item: PlannedFile): string {
  if (!sender.value?.admin || !schedule.value) return ''
  // An admin picks a room for any file with no scheduled room, once the upload is sent
  const roomId = item.scheduleQuizId ? roomOfScheduled(schedule.value, item.scheduleQuizId) : null
  return sender.value.rooms.find((room) => room.id === roomId)?.name ?? 'Picked when sent'
}

/** Send the reviewed files, report each, then have the page read the meet again */
async function sendUpload() {
  if (!meet.value) return
  const { id: meetId, name: meetName } = meet.value
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
    const reports = await sendPlanned(
      planned.value,
      choiceDialog.value,
      sender.value,
      meetName,
      schedule.value,
      (quizFile, roomId, onExisting, scheduleQuizId) =>
        uploadResult(meetId, quizFile, roomId, onExisting, scheduleQuizId),
    )
    if (!reports) return
    uploadReports.value = reports
    planned.value = []
    // The page reads the meet again, every tab with it
    void refresh()
  } catch (e) {
    uploadError.value = (e as Error).message
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
  </div>
  <div v-if="uploadError || planned.length > 0 || uploadReports.length > 0" class="upload-panel">
    <p v-if="uploadError" class="state-msg state-msg--error">{{ uploadError }}</p>
    <div v-if="planned.length > 0" class="upload-review">
      <table class="results-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Quiz</th>
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
                {{ quizName(item.quizFile.quiz) }}
                <span v-if="item.duplicate" class="note">another file names this quiz</span>
              </td>
              <td>
                <select
                  v-model="item.scheduleQuizId"
                  class="stage-select"
                  :aria-label="`Scheduled quiz for ${item.file}`"
                  @change="planned = markDuplicates(planned, schedule)"
                >
                  <option :value="null">
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
    <ul v-if="uploadReports.length > 0" class="upload-report">
      <li v-for="report in uploadReports" :key="report.file" :class="{ refused: !report.stored }">
        {{ report.file }}: {{ report.message }}
      </li>
    </ul>
    <button
      v-if="uploadReports.length > 0 && planned.length === 0"
      class="btn btn--secondary btn--sm"
      @click="uploadReports = []"
    >
      Done
    </button>
  </div>
  <ChoiceDialog ref="choiceDialog" />
</template>

<style scoped>
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
  margin-top: 0.5rem;
  padding-left: 1.25rem;
  font-size: 0.8rem;
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
