<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { MeetRole } from '@qzr/shared'

import {
  createMeetSlot,
  createScheduledQuiz,
  deleteMeetSlot,
  deleteScheduledQuiz,
  getMeet,
  getMyMeets,
  listMeetRooms,
  listMeetSlots,
  listScheduledQuizzes,
  updateMeetSlot,
  type MeetDetail,
  type MeetMembership,
  type MeetRoom,
  type MeetSlot,
  type ScheduledQuiz,
} from '../api'
import ScheduleGrid from '../components/ScheduleGrid.vue'

const props = defineProps<{ slug: string }>()
const router = useRouter()

const detail = ref<MeetDetail | null>(null)
const membership = ref<MeetMembership | null>(null)
const rooms = ref<MeetRoom[]>([])
const slots = ref<MeetSlot[]>([])
const quizzes = ref<ScheduledQuiz[]>([])
const loading = ref(true)
const error = ref('')
const divisionFilter = ref<string | null>(null)
const editMode = ref(false)

const meet = computed(() => detail.value?.meet ?? null)
const meetId = computed(() => detail.value?.meet.id ?? null)
const divisions = computed(() => meet.value?.divisions ?? [])
const role = computed(() => membership.value?.role ?? null)
const isAdmin = computed(() => role.value === MeetRole.Admin || role.value === MeetRole.Superuser)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [meetDetail, myMeetsRes] = await Promise.all([getMeet(props.slug), getMyMeets()])
    detail.value = meetDetail
    membership.value = myMeetsRes.memberships.find((m) => m.meetId === meetDetail.meet.id) ?? null
    const id = meetDetail.meet.id
    const [r, s, q] = await Promise.all([
      listMeetRooms(id),
      listMeetSlots(id),
      listScheduledQuizzes(id),
    ])
    rooms.value = r.rooms
    slots.value = s.slots
    quizzes.value = q.quizzes
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

// ---- Slot dialog ----

interface SlotDraft {
  mode: 'create' | 'edit'
  slotId: number | null
  date: string
  time: string
  durationMinutes: number
  kind: 'quiz' | 'event'
  eventLabel: string
  /** Used for create only; insertion position. */
  sortOrder: number
}

const slotDialogRef = ref<HTMLDialogElement | null>(null)
const slotDraft = ref<SlotDraft | null>(null)
const slotSaving = ref(false)
const slotError = ref('')

function isoToLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

function localPartsToIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString()
}

function defaultSlotDraft(): SlotDraft {
  // Anchor new slots near the last existing one, falling back to today.
  const last = slots.value[slots.value.length - 1]
  let date = ''
  let time = '08:00'
  let duration = 25
  if (last) {
    const lastEnd = new Date(new Date(last.startAt).getTime() + last.durationMinutes * 60_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    date = `${lastEnd.getFullYear()}-${pad(lastEnd.getMonth() + 1)}-${pad(lastEnd.getDate())}`
    time = `${pad(lastEnd.getHours())}:${pad(lastEnd.getMinutes())}`
    duration = last.durationMinutes
  } else {
    const start = meet.value?.dateFrom
    if (start) date = start
    else {
      const today = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    }
  }
  const maxSort = slots.value.reduce((m, s) => Math.max(m, s.sortOrder), -1)
  return {
    mode: 'create',
    slotId: null,
    date,
    time,
    durationMinutes: duration,
    kind: 'quiz',
    eventLabel: '',
    sortOrder: maxSort + 1,
  }
}

function openAddSlot() {
  slotError.value = ''
  slotDraft.value = defaultSlotDraft()
  nextTick(() => slotDialogRef.value?.showModal())
}

function openEditSlot(slot: MeetSlot) {
  const { date, time } = isoToLocalParts(slot.startAt)
  slotError.value = ''
  slotDraft.value = {
    mode: 'edit',
    slotId: slot.id,
    date,
    time,
    durationMinutes: slot.durationMinutes,
    kind: slot.kind,
    eventLabel: slot.eventLabel ?? '',
    sortOrder: slot.sortOrder,
  }
  nextTick(() => slotDialogRef.value?.showModal())
}

function closeSlotDialog() {
  slotDialogRef.value?.close()
  slotDraft.value = null
}

async function saveSlot() {
  const draft = slotDraft.value
  if (!draft || !meetId.value) return
  if (!draft.date || !draft.time) {
    slotError.value = 'Date and time are required'
    return
  }
  if (!Number.isFinite(draft.durationMinutes) || draft.durationMinutes <= 0) {
    slotError.value = 'Duration must be greater than 0'
    return
  }
  slotSaving.value = true
  slotError.value = ''
  try {
    const startAt = localPartsToIso(draft.date, draft.time)
    if (draft.mode === 'create') {
      const res = await createMeetSlot(meetId.value, {
        startAt,
        durationMinutes: draft.durationMinutes,
        kind: draft.kind,
        eventLabel: draft.kind === 'event' ? draft.eventLabel.trim() || null : null,
        sortOrder: draft.sortOrder,
      })
      slots.value = [...slots.value, res.slot].sort(slotSort)
    } else if (draft.slotId != null) {
      const res = await updateMeetSlot(meetId.value, draft.slotId, {
        startAt,
        durationMinutes: draft.durationMinutes,
        eventLabel: draft.kind === 'event' ? draft.eventLabel.trim() || null : null,
      })
      slots.value = slots.value.map((s) => (s.id === res.slot.id ? res.slot : s)).sort(slotSort)
    }
    closeSlotDialog()
  } catch (e) {
    slotError.value = (e as Error).message
  } finally {
    slotSaving.value = false
  }
}

function slotSort(a: MeetSlot, b: MeetSlot): number {
  return a.sortOrder - b.sortOrder || a.id - b.id
}

// ---- Quiz dialog ----

interface QuizDraft {
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  seatRefs: [string, string, string]
}

const quizDialogRef = ref<HTMLDialogElement | null>(null)
const quizDraft = ref<QuizDraft | null>(null)
const quizSaving = ref(false)
const quizError = ref('')

function nextQuizNumber(division: string): number {
  const used = new Set<number>()
  for (const q of quizzes.value) {
    if (q.division !== division) continue
    const m = q.label.match(/(\d+)\s*$/)
    if (m) used.add(Number(m[1]))
  }
  let n = 1
  while (used.has(n)) n++
  return n
}

function openAddQuiz(payload: { slotId: number; roomId: number }) {
  if (!divisions.value.length) {
    alert('Add a division to the meet before scheduling quizzes.')
    return
  }
  const initialDivision = divisionFilter.value ?? divisions.value[0]!
  quizError.value = ''
  quizDraft.value = {
    slotId: payload.slotId,
    roomId: payload.roomId,
    division: initialDivision,
    phase: 'prelim',
    label: `Div ${initialDivision} Quiz ${nextQuizNumber(initialDivision)}`,
    seatRefs: ['', '', ''],
  }
  nextTick(() => quizDialogRef.value?.showModal())
}

function closeQuizDialog() {
  quizDialogRef.value?.close()
  quizDraft.value = null
}

function onQuizDivisionChange() {
  const draft = quizDraft.value
  if (!draft) return
  draft.label = `Div ${draft.division} Quiz ${nextQuizNumber(draft.division)}`
}

async function saveQuiz() {
  const draft = quizDraft.value
  if (!draft || !meetId.value) return
  if (!draft.label.trim()) {
    quizError.value = 'Label is required'
    return
  }
  quizSaving.value = true
  quizError.value = ''
  try {
    const seats = draft.seatRefs.map((ref, i) => {
      const trimmed = ref.trim()
      const seat: { seatNumber: number; letter?: string | null; seedRef?: string | null } = {
        seatNumber: i + 1,
      }
      if (trimmed) {
        if (draft.phase === 'prelim') seat.letter = trimmed
        else seat.seedRef = trimmed
      }
      return seat
    })
    const res = await createScheduledQuiz(meetId.value, {
      slotId: draft.slotId,
      roomId: draft.roomId,
      division: draft.division,
      phase: draft.phase,
      label: draft.label.trim(),
      seats,
    })
    // POST returns the quiz row without seats; re-fetch to pull seat ids back.
    const refreshed = await listScheduledQuizzes(meetId.value)
    quizzes.value = refreshed.quizzes
    void res
    closeQuizDialog()
  } catch (e) {
    quizError.value = (e as Error).message
  } finally {
    quizSaving.value = false
  }
}

async function handleDeleteQuiz(quizId: number) {
  if (!meetId.value) return
  const quiz = quizzes.value.find((q) => q.id === quizId)
  if (!quiz) return
  if (!confirm(`Delete ${quiz.label}? This cannot be undone.`)) return
  try {
    await deleteScheduledQuiz(meetId.value, quizId)
    quizzes.value = quizzes.value.filter((q) => q.id !== quizId)
  } catch (e) {
    alert((e as Error).message)
  }
}

async function handleDeleteSlot(slotId: number) {
  if (!meetId.value) return
  const slot = slots.value.find((s) => s.id === slotId)
  if (!slot) return
  const label =
    slot.kind === 'event' ? slot.eventLabel || 'this event' : 'this slot and its quizzes'
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return
  try {
    await deleteMeetSlot(meetId.value, slotId)
    slots.value = slots.value.filter((s) => s.id !== slotId)
    quizzes.value = quizzes.value.filter((q) => q.slotId !== slotId)
  } catch (e) {
    alert((e as Error).message)
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
      <div class="page-header">
        <div class="page-header-text">
          <h2 class="page-title">Schedule</h2>
          <span class="meet-name">{{ meet.name }}</span>
        </div>
        <div v-if="isAdmin" class="page-header-actions">
          <button
            class="btn"
            :class="editMode ? 'btn--primary' : 'btn--secondary'"
            @click="editMode = !editMode"
          >
            {{ editMode ? 'Done editing' : 'Edit schedule' }}
          </button>
        </div>
      </div>

      <div v-if="divisions.length > 1" class="filter-row">
        <label class="filter-label" for="division-filter">Division</label>
        <select id="division-filter" v-model="divisionFilter" class="filter-select">
          <option :value="null">All</option>
          <option v-for="d in divisions" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>

      <ScheduleGrid
        :rooms="rooms"
        :slots="slots"
        :quizzes="quizzes"
        :division-filter="divisionFilter"
        :edit-mode="editMode && isAdmin"
        @edit-slot="openEditSlot"
        @delete-slot="handleDeleteSlot"
        @add-quiz="openAddQuiz"
        @delete-quiz="handleDeleteQuiz"
      />

      <button v-if="editMode && isAdmin" class="add-slot-btn" @click="openAddSlot">
        + Add slot
      </button>

      <dialog ref="quizDialogRef" class="dialog" @close="quizDraft = null">
        <form v-if="quizDraft" class="dialog-form" @submit.prevent="saveQuiz">
          <h3 class="dialog-title">Add quiz</h3>

          <div class="dialog-grid dialog-grid--two">
            <label class="field">
              <span class="field-label">Division</span>
              <select v-model="quizDraft.division" required @change="onQuizDivisionChange">
                <option v-for="d in divisions" :key="d" :value="d">{{ d }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Phase</span>
              <select v-model="quizDraft.phase">
                <option value="prelim">Prelim</option>
                <option value="elim">Elim</option>
              </select>
            </label>
          </div>

          <label class="field">
            <span class="field-label">Label</span>
            <input v-model="quizDraft.label" type="text" required />
          </label>

          <fieldset class="seats-fieldset">
            <legend class="field-label">
              {{ quizDraft.phase === 'prelim' ? 'Letters (A–U)' : 'Seed refs' }}
            </legend>
            <div class="seats-row">
              <input
                v-for="(_, i) in quizDraft.seatRefs"
                :key="i"
                v-model="quizDraft.seatRefs[i]"
                type="text"
                class="seat-input"
                :placeholder="String.fromCharCode(65 + i)"
                :maxlength="quizDraft.phase === 'prelim' ? 1 : undefined"
              />
            </div>
          </fieldset>

          <p v-if="quizError" class="field-error">{{ quizError }}</p>

          <div class="dialog-actions">
            <button type="button" class="btn btn--ghost" @click="closeQuizDialog">Cancel</button>
            <button type="submit" class="btn btn--primary" :disabled="quizSaving">
              {{ quizSaving ? 'Saving…' : 'Add quiz' }}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref="slotDialogRef" class="dialog" @close="slotDraft = null">
        <form v-if="slotDraft" class="dialog-form" @submit.prevent="saveSlot">
          <h3 class="dialog-title">
            {{ slotDraft.mode === 'create' ? 'Add slot' : 'Edit slot' }}
          </h3>

          <fieldset v-if="slotDraft.mode === 'create'" class="kind-row">
            <label class="kind-option">
              <input v-model="slotDraft.kind" type="radio" value="quiz" />
              Quiz round
            </label>
            <label class="kind-option">
              <input v-model="slotDraft.kind" type="radio" value="event" />
              Event
            </label>
          </fieldset>

          <div class="dialog-grid">
            <label class="field">
              <span class="field-label">Date</span>
              <input v-model="slotDraft.date" type="date" required />
            </label>
            <label class="field">
              <span class="field-label">Start time</span>
              <input v-model="slotDraft.time" type="time" required />
            </label>
            <label class="field">
              <span class="field-label">Duration (min)</span>
              <input
                v-model.number="slotDraft.durationMinutes"
                type="number"
                min="1"
                step="1"
                required
              />
            </label>
          </div>

          <label v-if="slotDraft.kind === 'event'" class="field">
            <span class="field-label">Event label</span>
            <input
              v-model="slotDraft.eventLabel"
              type="text"
              placeholder="e.g. Lunch, Stats Break"
            />
          </label>

          <p v-if="slotError" class="field-error">{{ slotError }}</p>

          <div class="dialog-actions">
            <button type="button" class="btn btn--ghost" @click="closeSlotDialog">Cancel</button>
            <button type="submit" class="btn btn--primary" :disabled="slotSaving">
              {{ slotSaving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </form>
      </dialog>
    </template>
  </div>
</template>

<style scoped>
.container {
  max-width: 64rem;
  margin: 0 auto;
  padding: 1rem;
}

.back-link {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font: inherit;
  cursor: pointer;
  padding: 0.25rem 0;
  margin-bottom: 0.5rem;
}

.back-link:hover {
  color: var(--color-text);
}

.state-msg {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  padding: 1rem 0;
}

.state-msg--error {
  color: var(--color-invalid, #c00);
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.page-header-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.page-title {
  font-size: 1.4rem;
  margin: 0;
}

.meet-name {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.filter-label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.filter-select {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.85rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
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
  color: var(--color-text);
  border-color: var(--color-text-muted);
}

.btn--ghost {
  background: transparent;
  color: var(--color-text-faint);
  border-color: transparent;
}

.btn--ghost:hover:not(:disabled) {
  color: var(--color-text-muted);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.add-slot-btn {
  margin-top: 0.75rem;
  width: 100%;
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  padding: 0.55rem;
  font-size: 0.8rem;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;
}

.add-slot-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.dialog {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 1.25rem;
  max-width: 24rem;
  width: calc(100vw - 2rem);
  margin: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

.dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.dialog-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
  color: var(--color-heading, var(--color-text));
}

.kind-row {
  display: flex;
  gap: 1rem;
  border: none;
  padding: 0;
  margin: 0;
}

.kind-option {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  cursor: pointer;
}

.dialog-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.6rem;
}

.dialog-grid--two {
  grid-template-columns: 1fr 1fr;
}

.field select {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg);
  color: var(--color-text);
}

.seats-fieldset {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  border: none;
  padding: 0;
  margin: 0;
}

.seats-fieldset .field-label {
  display: block;
  margin-bottom: 0.1rem;
}

.seats-row {
  display: flex;
  gap: 0.4rem;
}

.seat-input {
  flex: 1;
  font: inherit;
  font-size: 0.85rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg);
  color: var(--color-text);
  text-transform: uppercase;
  text-align: center;
  min-width: 0;
}

.seat-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.field-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-faint);
  text-transform: uppercase;
}

.field input {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg);
  color: var(--color-text);
  min-width: 0;
}

.field input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.field-error {
  font-size: 0.78rem;
  color: var(--color-invalid, #c00);
  margin: 0;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
</style>
