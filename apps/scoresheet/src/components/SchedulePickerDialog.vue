<script setup lang="ts">
import { ref, shallowRef } from 'vue'

import { ScheduleGrid } from '@qzr/ui'

import {
  type MeetRoomSummary,
  type MeetSlotSummary,
  type MeetSummary,
  type PrelimAssignmentRow,
  type ScheduledQuizSummaryRow,
  listMeetRooms,
  listMeetSlots,
  listPrelimAssignments,
  listScheduledQuizzes,
} from '../api'
import { initGuestSession } from '../composables/useGuestSession'
import { useMeetList } from '../composables/useMeetList'
import { useMeetSession } from '../composables/useMeetSession'
import { QUIZZERS_PER_TEAM } from '../types/scoresheet'

const emit = defineEmits<{ loaded: [{ quizId: number }] }>()

const meetSession = useMeetSession()
const {
  meets,
  loading: meetsLoading,
  error: meetsError,
  joinCode,
  joinError,
  joining,
  init: initMeetList,
  handleJoinCode,
  setActiveGuest,
} = useMeetList()

type Step = 'meet' | 'quiz'

const dialogRef = ref<HTMLDialogElement | null>(null)
const step = ref<Step>('meet')
const activeMeetId = ref<number | null>(null)
const activeMeetName = ref<string>('')
const submitting = ref(false)

const quizzes = shallowRef<ScheduledQuizSummaryRow[]>([])
const rooms = shallowRef<MeetRoomSummary[]>([])
const slots = shallowRef<MeetSlotSummary[]>([])
const prelimAssignments = shallowRef<PrelimAssignmentRow[]>([])
const quizLoading = ref(false)
const quizError = ref('')

async function loadQuizzesForMeet(meetId: number) {
  quizLoading.value = true
  quizError.value = ''
  try {
    const [q, r, s, p] = await Promise.all([
      listScheduledQuizzes(meetId),
      listMeetRooms(meetId),
      listMeetSlots(meetId),
      listPrelimAssignments(meetId),
    ])
    quizzes.value = q.quizzes
    rooms.value = r.rooms
    slots.value = s.slots
    prelimAssignments.value = p.assignments
  } catch (e) {
    quizError.value = (e as Error).message
  } finally {
    quizLoading.value = false
  }
}

async function selectMeet(meet: MeetSummary) {
  submitting.value = true
  meetsError.value = ''
  try {
    setActiveGuest(meet.meetId)
    activeMeetId.value = meet.meetId
    activeMeetName.value = meet.meetName
    step.value = 'quiz'
    await loadQuizzesForMeet(meet.meetId)
  } catch (e) {
    meetsError.value = (e as Error).message
  } finally {
    submitting.value = false
  }
}

async function pickQuiz(quizId: number) {
  if (activeMeetId.value === null) return
  submitting.value = true
  quizError.value = ''
  try {
    await meetSession.loadFromQuiz(
      activeMeetId.value,
      quizId,
      activeMeetName.value,
      [0, 1, 2].map(() => Array<string>(QUIZZERS_PER_TEAM).fill('')),
    )
    dialogRef.value?.close()
    emit('loaded', { quizId })
  } catch (e) {
    quizError.value = (e as Error).message
  } finally {
    submitting.value = false
  }
}

function backToMeetStep() {
  step.value = 'meet'
  activeMeetId.value = null
  activeMeetName.value = ''
  quizzes.value = []
  rooms.value = []
  slots.value = []
  prelimAssignments.value = []
}

function close() {
  dialogRef.value?.close()
}

async function open() {
  dialogRef.value?.showModal()
  // initGuestSession() runs fire-and-forget at app start; await it here
  // so the early-return path's loadQuizzesForMeet doesn't fire its API
  // calls before the guest JWT is attached (initMeetList() awaits it
  // for the meet-picker step). Cached promise — no extra round-trip.
  await initGuestSession()
  // If a meet is already loaded, jump straight to the quiz step for it.
  if (meetSession.isActive.value) {
    const session = meetSession.snapshotSession()
    if (session) {
      activeMeetId.value = session.meetId
      activeMeetName.value = session.meetName
      step.value = 'quiz'
      await loadQuizzesForMeet(session.meetId)
      return
    }
  }
  step.value = 'meet'
  await initMeetList()
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialogRef" class="schedule-picker-dialog" @click.self="close">
    <div class="schedule-picker-inner">
      <div class="schedule-picker-header">
        <span class="schedule-picker-title">
          {{ step === 'meet' ? 'Load from schedule' : `Load from schedule — ${activeMeetName}` }}
        </span>
        <button class="schedule-picker-close" @click="close">×</button>
      </div>

      <!-- Step 1: pick a meet (skipped when a meet is already active) -->
      <template v-if="step === 'meet'">
        <p v-if="meetsLoading" class="schedule-picker-state">Loading…</p>
        <p v-else-if="meetsError" class="schedule-picker-state schedule-picker-state--error">
          {{ meetsError }}
        </p>
        <p v-else-if="meets.length === 0" class="schedule-picker-state">No meets found.</p>

        <ul v-else class="meet-list">
          <li v-for="meet in meets" :key="meet.meetId">
            <button class="meet-row" :disabled="submitting" @click="selectMeet(meet)">
              <span class="meet-row-name">{{ meet.meetName }}</span>
              <span class="meet-row-role">{{ meet.role }}</span>
            </button>
          </li>
        </ul>

        <hr class="schedule-picker-divider" />

        <form class="join-form" @submit.prevent="handleJoinCode">
          <p class="join-label">Have a code?</p>
          <div class="join-row">
            <input
              v-model="joinCode"
              class="join-input"
              placeholder="Enter a code to join a meet"
              :disabled="joining"
            />
            <button type="submit" class="join-btn" :disabled="joining || !joinCode.trim()">
              {{ joining ? '…' : 'Join' }}
            </button>
          </div>
          <p v-if="joinError" class="join-error">{{ joinError }}</p>
        </form>
      </template>

      <!-- Step 2: pick a scheduled quiz -->
      <template v-else>
        <p v-if="quizLoading" class="schedule-picker-state">Loading schedule…</p>
        <p v-else-if="quizError" class="schedule-picker-state schedule-picker-state--error">
          {{ quizError }}
        </p>
        <ScheduleGrid
          v-else
          :rooms="rooms"
          :slots="slots"
          :quizzes="quizzes"
          :prelim-assignments="prelimAssignments"
          empty-message="This meet has no scheduled quizzes yet."
        >
          <template #quiz-label="{ quiz }">
            <button
              type="button"
              class="picker-quiz-btn"
              :disabled="submitting"
              :title="`Load ${quiz.label} into the scoresheet`"
              @click="pickQuiz(quiz.id)"
            >
              {{ quiz.label }}
            </button>
          </template>
        </ScheduleGrid>

        <div class="schedule-picker-actions">
          <button
            v-if="!meetSession.isActive.value"
            type="button"
            class="schedule-picker-back"
            @click="backToMeetStep"
          >
            ← Pick a different meet
          </button>
          <span class="schedule-picker-actions-spacer" />
        </div>
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.schedule-picker-dialog {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 0;
  width: min(60rem, 95vw);
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  inset: 0;
  margin: auto;
}

.schedule-picker-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.schedule-picker-inner {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 90vh;
  overflow-y: auto;
}

.schedule-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.schedule-picker-title {
  font-weight: 700;
  font-size: 0.9rem;
}

.schedule-picker-close {
  background: none;
  border: none;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
}

.schedule-picker-close:hover {
  color: var(--color-text);
  background: var(--color-border-alt);
}

.schedule-picker-state {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  text-align: center;
  padding: 1.5rem 0;
}

.schedule-picker-state--error {
  color: var(--color-invalid);
}

.meet-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
}

.meet-row {
  width: 100%;
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
  transition:
    background 0.1s,
    border-color 0.1s;
}

.meet-row:hover:not(:disabled) {
  background: var(--color-border-alt);
  border-color: var(--color-accent);
}

.meet-row:disabled {
  opacity: 0.5;
  cursor: default;
}

.meet-row-name {
  font-weight: 600;
}

.meet-row-role {
  font-size: 0.7rem;
  color: var(--color-text-faint);
  text-transform: capitalize;
  flex-shrink: 0;
}

.schedule-picker-divider {
  border: none;
  border-top: 1px solid var(--color-border-alt);
  margin: 0;
}

.join-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.join-label {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  margin: 0;
}

.join-row {
  display: flex;
  gap: 0.5rem;
}

.join-input {
  flex: 1;
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--color-text);
}

.join-input:focus {
  outline: 1px solid var(--color-accent);
  border-color: var(--color-accent);
}

.join-btn {
  background: var(--color-accent);
  border: none;
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
  font-size: 0.8rem;
  font-family: inherit;
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}

.join-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.join-btn:not(:disabled):hover {
  filter: brightness(1.1);
}

.join-error {
  font-size: 0.75rem;
  color: var(--color-invalid);
  margin: 0;
}

.picker-quiz-btn {
  background: none;
  border: 0;
  font: inherit;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--color-text);
  cursor: pointer;
  padding: 0;
  border-radius: 3px;
}

.picker-quiz-btn:hover:not(:disabled) {
  color: var(--color-accent);
  text-decoration: underline;
}

.picker-quiz-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

.schedule-picker-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-top: 1px solid var(--color-border-alt);
  padding-top: 0.75rem;
}

.schedule-picker-back {
  background: none;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
  font: inherit;
  font-size: 0.78rem;
  color: var(--color-text-muted);
  cursor: pointer;
}

.schedule-picker-back:hover {
  background: var(--color-border-alt);
  color: var(--color-text);
}

.schedule-picker-actions-spacer {
  flex: 1;
}
</style>
