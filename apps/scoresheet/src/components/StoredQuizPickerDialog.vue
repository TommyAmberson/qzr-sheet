<script setup lang="ts">
import { computed, ref } from 'vue'

import { ApiError, quizName, type QuizFile } from '@qzr/shared'
import { formatWhen } from '@qzr/ui'

import {
  getStoredQuizVersions,
  getStoredQuizzes,
  STORED_QUIZZES_REFUSED,
  type MeetSummary,
  type StoredQuiz,
  type StoredQuizVersion,
} from '../api'
import { initGuestSession } from '../composables/useGuestSession'
import { useMeetList } from '../composables/useMeetList'
import { useMeetSession } from '../composables/useMeetSession'

const props = defineProps<{
  /** Opens the picked quiz; true when it was opened and the dialog should close */
  onPick: (meetId: number, meetName: string, quizFile: QuizFile) => Promise<boolean>
}>()

const meetSession = useMeetSession()
const {
  meets,
  loading: meetsLoading,
  error: meetsError,
  init: initMeetList,
  setActiveGuest,
} = useMeetList()

const dialogRef = ref<HTMLDialogElement | null>(null)
/** The meet whose stored quizzes are listed; none while the meet is still to be chosen */
const meet = ref<{ id: number; name: string } | null>(null)
const quizzes = ref<StoredQuiz[]>([])
const loading = ref(false)
const error = ref('')
/** The quiz whose earlier versions are shown, and those versions once fetched */
const versionsOf = ref<number | null>(null)
const versions = ref<StoredQuizVersion[]>([])
/** Why a quiz's earlier versions couldn't be listed; the quiz list stays */
const versionsError = ref('')

const listed = computed(() =>
  [...quizzes.value].sort((a, b) =>
    quizName(a.quizFile.quiz).localeCompare(quizName(b.quizFile.quiz), undefined, {
      numeric: true,
    }),
  ),
)

/** Why a list couldn't be shown: the meet's own rule for who sees stored quizzes, or the failure */
function reason(e: unknown): string {
  return e instanceof ApiError && e.status === 403 ? STORED_QUIZZES_REFUSED : (e as Error).message
}

async function listFor(meetId: number, meetName: string) {
  meet.value = { id: meetId, name: meetName }
  quizzes.value = []
  versionsOf.value = null
  loading.value = true
  error.value = ''
  try {
    quizzes.value = await getStoredQuizzes(meetId)
  } catch (e) {
    error.value = reason(e)
  } finally {
    loading.value = false
  }
}

function selectMeet(picked: MeetSummary) {
  setActiveGuest(picked.meetId)
  void listFor(picked.meetId, picked.meetName)
}

/** Show a quiz's earlier versions under it, or hide them again */
async function toggleVersions(quiz: StoredQuiz) {
  if (versionsOf.value === quiz.id) {
    versionsOf.value = null
    return
  }
  if (!meet.value) return
  versionsOf.value = quiz.id
  versions.value = []
  versionsError.value = ''
  try {
    const all = await getStoredQuizVersions(meet.value.id, quiz.id)
    // Another quiz's versions asked for meanwhile: these are no longer wanted
    if (versionsOf.value !== quiz.id) return
    // The current version is the row itself, and a revision restoring it shows the same file
    versions.value = all.filter((version) => !version.current)
  } catch (e) {
    if (versionsOf.value === quiz.id) versionsError.value = reason(e)
  }
}

async function pick(quizFile: QuizFile) {
  if (!meet.value) return
  if (await props.onPick(meet.value.id, meet.value.name, quizFile)) close()
}

function close() {
  dialogRef.value?.close()
}

async function open() {
  meet.value = null
  quizzes.value = []
  error.value = ''
  // Versions shown last time may be out of date by now: each opening starts with none expanded
  versionsOf.value = null
  versions.value = []
  versionsError.value = ''
  dialogRef.value?.showModal()
  // The guest token must be attached before the list is asked for
  await initGuestSession()
  const linked = meetSession.meetId.value
  if (linked !== null) await listFor(linked, meetSession.meetName.value ?? '')
  else await initMeetList()
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialogRef" class="stored-picker" @click.self="close">
    <div class="stored-picker__inner">
      <div class="stored-picker__header">
        <span class="stored-picker__title">
          {{ meet ? `Open from the meet — ${meet.name}` : 'Open from the meet' }}
        </span>
        <button class="stored-picker__close" aria-label="Close" @click="close">×</button>
      </div>

      <template v-if="!meet">
        <p v-if="meetsLoading" class="stored-picker__state">Loading…</p>
        <p v-else-if="meetsError" class="stored-picker__state stored-picker__state--error">
          {{ meetsError }}
        </p>
        <p v-else-if="meets.length === 0" class="stored-picker__state">No meets found.</p>
        <ul v-else class="stored-picker__list">
          <li v-for="m in meets" :key="m.meetId">
            <button class="stored-picker__row" @click="selectMeet(m)">
              <span class="stored-picker__name">{{ m.meetName }}</span>
              <span class="stored-picker__when">{{ m.role }}</span>
            </button>
          </li>
        </ul>
      </template>

      <template v-else>
        <p v-if="loading" class="stored-picker__state">Loading stored quizzes…</p>
        <p v-else-if="error" class="stored-picker__state stored-picker__state--error">
          {{ error }}
        </p>
        <p v-else-if="listed.length === 0" class="stored-picker__state">
          This meet has no stored quizzes that you can open.
        </p>
        <ul v-else class="stored-picker__list">
          <li v-for="quiz in listed" :key="quiz.id">
            <div class="stored-picker__quiz">
              <button
                class="stored-picker__row"
                :title="`Open ${quizName(quiz.quizFile.quiz)}`"
                @click="pick(quiz.quizFile)"
              >
                <span class="stored-picker__name">{{ quizName(quiz.quizFile.quiz) }}</span>
                <span class="stored-picker__when">saved {{ formatWhen(quiz.savedAt) }}</span>
              </button>
              <button
                v-if="quiz.revision > 1"
                class="stored-picker__earlier"
                :aria-expanded="versionsOf === quiz.id"
                @click="toggleVersions(quiz)"
              >
                Earlier versions
              </button>
            </div>
            <p
              v-if="versionsOf === quiz.id && versionsError"
              class="stored-picker__state stored-picker__state--error"
            >
              {{ versionsError }}
            </p>
            <ul v-if="versionsOf === quiz.id" class="stored-picker__list stored-picker__versions">
              <li v-for="version in versions" :key="version.revision">
                <button class="stored-picker__row" @click="pick(version.quizFile)">
                  <span class="stored-picker__name">Version {{ version.revision }}</span>
                  <span class="stored-picker__when">
                    saved {{ formatWhen(version.savedAt) }} by {{ version.savedBy.name }}
                  </span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.stored-picker {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 0;
  width: min(32rem, 95vw);
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  inset: 0;
  margin: auto;
}

.stored-picker::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.stored-picker__inner {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 90vh;
  overflow-y: auto;
}

.stored-picker__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stored-picker__title {
  font-weight: 700;
  font-size: 0.9rem;
}

.stored-picker__close {
  background: none;
  border: none;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
}

.stored-picker__state {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  text-align: center;
  padding: 1.5rem 0;
}

.stored-picker__state--error {
  color: var(--color-invalid);
}

.stored-picker__list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
}

.stored-picker__versions {
  margin: 2px 0 4px 1.5rem;
}

.stored-picker__quiz {
  display: flex;
  gap: 4px;
}

.stored-picker__row {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  background: none;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
}

.stored-picker__row:hover,
.stored-picker__earlier:hover {
  background: var(--color-border-alt);
  border-color: var(--color-accent);
}

.stored-picker__name {
  font-weight: 600;
}

.stored-picker__when {
  font-size: 0.7rem;
  color: var(--color-text-faint);
  flex-shrink: 0;
}

.stored-picker__earlier {
  background: none;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0 0.6rem;
  font-size: 0.7rem;
  font-family: inherit;
  color: var(--color-text-faint);
  cursor: pointer;
}
</style>
