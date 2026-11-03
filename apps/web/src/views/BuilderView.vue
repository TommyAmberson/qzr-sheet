<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { ChoiceDialog, ScheduleBasic, ScheduleList, ScheduleSheet } from '@qzr/ui'
import type { SheetView } from '@qzr/shared'

import { addRoom, moveQuiz, swapSeats } from '../builder/edits'
import { keepSchedule, loadSchedule, saveScheduleFile } from '../builder/persistence'
import ElimSection from '../components/builder/ElimSection.vue'
import FrameSection from '../components/builder/FrameSection.vue'
import PrelimSection from '../components/builder/PrelimSection.vue'
import QuizMenu from '../components/builder/QuizMenu.vue'
import RoomMenu from '../components/builder/RoomMenu.vue'
import RowMenu from '../components/builder/RowMenu.vue'
import TeamsSection from '../components/builder/TeamsSection.vue'
import { useScheduleBuilder } from '../composables/useScheduleBuilder'

/** A schedule kept in this browser, by id; without one, a new schedule */
const props = defineProps<{ id?: string }>()
const kept = props.id ? loadSchedule(props.id) : null
const missing = props.id !== undefined && kept === null

const {
  doc,
  change,
  changeSettings,
  setAutoApply,
  unapplied,
  pendingMoves,
  apply,
  conflicts,
  issues,
  undo,
  redo,
  canUndo,
  canRedo,
} = useScheduleBuilder(kept ?? undefined)

/** The popup open on the grid, if any: one at a time (FR-005c) */
type Popup =
  | { kind: 'quiz'; id: string; anchor: HTMLElement; seat?: number }
  | { kind: 'row'; id: string; anchor: HTMLElement }
  | { kind: 'room'; id: string; anchor: HTMLElement }
const popup = ref<Popup | null>(null)

/** A move or seat swap waiting for its target, chosen by click, tap or keyboard (FR-005a) */
type Pending = { kind: 'move'; id: string } | { kind: 'seat'; id: string; index: number }
const pending = ref<Pending | null>(null)

function onQuiz(id: string, anchor: HTMLElement) {
  const p = pending.value
  if (p?.kind === 'move') {
    const target = doc.value.quizzes.find((q) => q.id === id)
    pending.value = null
    if (p.id !== id && target?.cell) change((d) => moveQuiz(d, p.id, target.cell))
    return
  }
  popup.value = { kind: 'quiz', id, anchor }
}

function onSeat(id: string, index: number, anchor: HTMLElement) {
  const p = pending.value
  if (p?.kind === 'seat') {
    pending.value = null
    if (p.id !== id || p.index !== index) change((d) => swapSeats(d, p.id, p.index, id, index))
    return
  }
  if (p?.kind === 'move') return onQuiz(id, anchor)
  popup.value = { kind: 'quiz', id, anchor, seat: index }
}

function onCell(slot: string, room: string) {
  const p = pending.value
  if (p?.kind !== 'move') return
  pending.value = null
  change((d) => moveQuiz(d, p.id, { slot, room }))
}

function startMove(id: string) {
  popup.value = null
  pending.value = { kind: 'move', id }
}

function startSeatSwap(id: string, index: number) {
  popup.value = null
  pending.value = { kind: 'seat', id, index }
}

function toTray() {
  const p = pending.value
  if (p?.kind !== 'move') return
  pending.value = null
  change((d) => moveQuiz(d, p.id, null))
}

// Dragging, with pointer events (the HTML5 drag API crashes Tauri on Linux): a quiz onto a cell,
// another quiz or the tray, or a seat onto another seat
let drag: { quiz: string; seat: number | null; x: number; y: number; on: boolean } | null = null
let dragged = false

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const el = event.target as HTMLElement
  const seat = el.closest<HTMLElement>('[data-seat]')
  const quiz = el.closest<HTMLElement>('[data-quiz]')
  if (!quiz) return
  const [, index] = seat?.dataset.seat?.split(':') ?? []
  drag = {
    quiz: quiz.dataset.quiz!,
    seat: index === undefined ? null : Number(index),
    x: event.clientX,
    y: event.clientY,
    on: false,
  }
}

function onPointerMove(event: PointerEvent) {
  if (!drag || drag.on) return
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 6) drag.on = true
}

function onPointerUp(event: PointerEvent) {
  const d = drag
  drag = null
  if (!d?.on) return
  dragged = true
  setTimeout(() => (dragged = false))
  const over = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
  if (!over) return
  if (d.seat !== null) {
    const target = over.closest<HTMLElement>('[data-seat]')?.dataset.seat?.split(':')
    if (target && (target[0] !== d.quiz || Number(target[1]) !== d.seat)) {
      change((x) => swapSeats(x, d.quiz, d.seat!, target[0]!, Number(target[1])))
    }
    return
  }
  const onQuiz = over.closest<HTMLElement>('[data-quiz]')?.dataset.quiz
  const onCell = over.closest<HTMLElement>('[data-cell]')?.dataset.cell?.split('|')
  if (over.closest('.tray')) change((x) => moveQuiz(x, d.quiz, null))
  else if (onQuiz && onQuiz !== d.quiz) {
    const target = doc.value.quizzes.find((q) => q.id === onQuiz)
    if (target?.cell) change((x) => moveQuiz(x, d.quiz, target.cell))
  } else if (onCell) change((x) => moveQuiz(x, d.quiz, { slot: onCell[0]!, room: onCell[1]! }))
}

/** A click that ends a drag isn't a click */
function swallowAfterDrag(event: Event) {
  if (dragged) event.stopPropagation()
}

/** On a phone the settings open as a sheet over the grid (FR-005b) */
const panelOpen = ref(false)

// Every change is kept in this browser at once (FR-002)
const keepFailed = ref(false)
watch(doc, (d) => (keepFailed.value = !missing && !keepSchedule(d)), { immediate: true })

/** Letters, or drawn teams once a division has a draw (FR-043) */
const view = ref<SheetView>('letters')
const anyDrawn = computed(() =>
  Object.values(doc.value.draw).some((d) => d.teams.some((t) => t.letter)),
)

/** Print the grid, a one-room list, or the basic schedule (FR-044) */
const printing = ref<'grid' | 'list' | 'basic'>('grid')
async function print(kind: 'grid' | 'list' | 'basic') {
  printing.value = kind
  await nextTick()
  window.print()
}

/** How many unapplied settings each section holds (FR-012a) */
const unappliedIn = (key: string) => unapplied.value.filter((u) => u.section === key).length

// In-page confirmations; the builder never uses a browser dialog (FR-007)
const dialog = useTemplateRef<InstanceType<typeof ChoiceDialog>>('dialog')

/** Apply waiting settings, first saying how many quizzes will move */
async function confirmApply() {
  const moves = pendingMoves()
  const go = await dialog.value?.ask(
    'Apply the changed settings?',
    `${moves} ${moves === 1 ? 'quiz' : 'quizzes'} will move or change. Pinned quizzes stay.`,
    [
      { label: 'Cancel', value: false },
      { label: 'Apply', value: true, primary: true },
    ],
  )
  if (go) apply()
}

const problems = computed(() => conflicts.value.filter((c) => !c.warning).length)
const warnings = computed(() => conflicts.value.filter((c) => c.warning).length)
const tray = computed(() => doc.value.quizzes.filter((q) => !q.cell))

/** Step through the flagged quizzes, one at a time (FR-037) */
const flagged = computed(() => [...issues.value.keys()])
const step = ref(-1)
function nextIssue() {
  if (flagged.value.length === 0) return
  step.value = (step.value + 1) % flagged.value.length
  document
    .querySelector(`[data-quiz="${flagged.value[step.value]}"]`)
    ?.scrollIntoView({ block: 'center', inline: 'center' })
}

const SECTIONS = [
  { key: 'teams', title: 'Teams' },
  { key: 'frame', title: 'Time slots and rooms' },
  { key: 'prelims', title: 'Prelim settings' },
  { key: 'elims', title: 'Elim settings' },
] as const
type SectionKey = (typeof SECTIONS)[number]['key']

/** Only one section is open at a time (FR-004) */
const open = ref<SectionKey | null>('teams')
function toggle(key: SectionKey) {
  open.value = open.value === key ? null : key
}

function rename(event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  if (name && name !== doc.value.name) change((d) => (d.name = name))
}

function onKey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
  if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return
  event.preventDefault()
  if (event.shiftKey) redo()
  else undo()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="builder">
    <header class="builder-bar">
      <input class="schedule-name" :value="doc.name" aria-label="Schedule name" @change="rename" />
      <button
        type="button"
        class="settings-toggle"
        :aria-expanded="panelOpen"
        @click="panelOpen = !panelOpen"
      >
        Settings
      </button>
      <span class="spacer" />
      <button type="button" class="issue-count" :disabled="flagged.length === 0" @click="nextIssue">
        {{ problems }} {{ problems === 1 ? 'problem' : 'problems' }}, {{ warnings }}
        {{ warnings === 1 ? 'warning' : 'warnings' }}
      </button>
      <div class="view-toggle" role="group" aria-label="Show">
        <button type="button" :aria-pressed="view === 'letters'" @click="view = 'letters'">
          Letters
        </button>
        <button
          type="button"
          :aria-pressed="view === 'teams'"
          :disabled="!anyDrawn"
          @click="view = 'teams'"
        >
          Teams
        </button>
      </div>
      <select
        class="print"
        aria-label="Print"
        value=""
        @change="
          (print(($event.target as HTMLSelectElement).value as 'grid' | 'list' | 'basic'),
          (($event.target as HTMLSelectElement).value = ''))
        "
      >
        <option value="" disabled>Print…</option>
        <option value="grid">Room grid</option>
        <option value="list">One-room list</option>
        <option value="basic">Basic schedule</option>
      </select>
      <button type="button" class="save-file" @click="saveScheduleFile(doc)">Save to file</button>
      <button type="button" :disabled="!canUndo" aria-label="Undo" @click="undo">Undo</button>
      <button type="button" :disabled="!canRedo" aria-label="Redo" @click="redo">Redo</button>
    </header>

    <div class="builder-main">
      <aside class="panel" :class="{ open: panelOpen }">
        <div class="auto-apply">
          <label>
            <input
              type="checkbox"
              role="switch"
              :checked="doc.settings.autoApply"
              aria-label="Auto-apply"
              @change="setAutoApply(($event.target as HTMLInputElement).checked)"
            />
            Auto-apply
          </label>
          <span class="hint">
            {{
              doc.settings.autoApply
                ? 'Changes apply to the grid as you make them.'
                : 'Changes wait until you press Apply.'
            }}
          </span>
          <div v-if="!doc.settings.autoApply && unapplied.length > 0" class="apply-bar">
            {{ unapplied.length }} unapplied {{ unapplied.length === 1 ? 'change' : 'changes' }}
            <button type="button" class="apply" @click="confirmApply">Apply</button>
          </div>
        </div>
        <section v-for="s in SECTIONS" :key="s.key" class="panel-section" :data-section="s.key">
          <button
            type="button"
            class="section-head"
            :aria-expanded="open === s.key"
            @click="toggle(s.key)"
          >
            {{ s.title }}
            <span v-if="unappliedIn(s.key) > 0" class="count"
              >{{ unappliedIn(s.key) }} unapplied</span
            >
          </button>
          <div v-if="open === s.key" class="section-body">
            <TeamsSection v-if="s.key === 'teams'" :doc="doc" @change="changeSettings" />
            <FrameSection
              v-else-if="s.key === 'frame'"
              :doc="doc"
              :unapplied="unapplied"
              @change="changeSettings"
            />
            <ElimSection
              v-else-if="s.key === 'elims'"
              :doc="doc"
              :unapplied="unapplied"
              @change="changeSettings"
            />
            <PrelimSection
              v-else-if="s.key === 'prelims'"
              :doc="doc"
              :unapplied="unapplied"
              @change="changeSettings"
            />
          </div>
        </section>
      </aside>

      <main class="grid-area">
        <p v-if="missing" class="message" role="status">
          This schedule isn't in this browser any more; its stored data may have been cleared. Open
          it from a file if you saved one.
        </p>
        <p v-if="keepFailed" class="message" role="status">
          This browser couldn't keep the schedule. Save it to a file so nothing is lost.
        </p>
        <p v-if="doc.settings.divisions.length === 0" class="empty">
          Enter each division's team count in Teams to build the schedule.
        </p>
        <p v-if="pending" class="pending">
          {{
            pending.kind === 'move'
              ? 'Choose where it goes: a cell, another quiz to swap with, or'
              : 'Choose the seat to swap with'
          }}
          <button v-if="pending.kind === 'move'" type="button" @click="toTray">
            the unplaced tray
          </button>
          <button type="button" @click="pending = null">Cancel</button>
        </p>
        <div
          class="sheet-wrap"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @click.capture="swallowAfterDrag"
        >
          <ScheduleSheet
            v-if="doc.rooms.length > 0"
            :class="{ 'print-hidden': printing !== 'grid' }"
            :doc="doc"
            :view="view"
            :issues="issues"
            :selected="pending?.kind === 'move' ? pending.id : null"
            @quiz="onQuiz"
            @seat="onSeat"
            @cell="onCell"
            @row="(id, el) => (popup = { kind: 'row', id, anchor: el })"
            @room="(id, el) => (popup = { kind: 'room', id, anchor: el })"
          />
        </div>
        <button type="button" class="add-room" @click="change((d) => addRoom(d))">+ Room</button>
        <section v-if="tray.length > 0" class="tray" aria-label="Unplaced quizzes">
          <h3>Unplaced</h3>
          <ul>
            <li v-for="q in tray" :key="q.id" :data-quiz="q.id">
              <button
                type="button"
                class="tray-quiz"
                @click="onQuiz(q.id, $event.currentTarget as HTMLElement)"
              >
                {{ q.label }}
              </button>
              {{ (issues.get(q.id) ?? []).map((c) => c.reason).join('; ') }}
            </li>
          </ul>
        </section>
      </main>
    </div>
    <div class="print-only">
      <h2>{{ doc.name }}</h2>
      <ScheduleList v-if="printing === 'list'" :doc="doc" :view="view" />
      <ScheduleBasic v-else-if="printing === 'basic'" :doc="doc" />
    </div>
    <QuizMenu
      v-if="popup?.kind === 'quiz'"
      :key="popup.id"
      :doc="doc"
      :quiz-id="popup.id"
      :anchor="popup.anchor"
      :seat="popup.seat ?? null"
      @change="change"
      @close="popup = null"
      @move="startMove"
      @swap-seat="startSeatSwap"
    />
    <RowMenu
      v-else-if="popup?.kind === 'row'"
      :doc="doc"
      :row-id="popup.id"
      :anchor="popup.anchor"
      @change="change"
      @close="popup = null"
    />
    <RoomMenu
      v-else-if="popup?.kind === 'room'"
      :doc="doc"
      :room-id="popup.id"
      :anchor="popup.anchor"
      @change="change"
      @close="popup = null"
    />
    <ChoiceDialog ref="dialog" />
  </div>
</template>

<style scoped>
.builder {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 4rem);
}

.builder-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border, #ddd);
}

.schedule-name {
  font: inherit;
  font-weight: 600;
  border: 1px solid transparent;
  background: transparent;
  padding: 0.25rem 0.5rem;
}

.schedule-name:hover,
.schedule-name:focus {
  border-color: var(--color-border, #ddd);
}

.spacer {
  flex: 1;
}

.builder-main {
  flex: 1;
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  min-height: 0;
}

.panel {
  border-right: 1px solid var(--color-border, #ddd);
  overflow-y: auto;
}

.section-head {
  width: 100%;
  text-align: left;
  font: inherit;
  font-weight: 600;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-border, #ddd);
  cursor: pointer;
}

.section-body {
  padding: 0.75rem 1rem;
}

.grid-area {
  overflow: auto;
  padding: 1rem;
}

.auto-apply {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border, #ddd);
}

.hint {
  font-size: 0.8rem;
  color: var(--color-text-muted, #666);
}

.apply-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.count {
  float: right;
  font-size: 0.75rem;
  font-weight: normal;
  color: var(--color-warn, #a60);
}

.pending {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.sheet-wrap {
  touch-action: pan-x pan-y;
}

.settings-toggle {
  display: none;
}

/* On a phone the panel is a sheet over the grid, and the grid scrolls sideways (FR-005b) */
@media (max-width: 700px) {
  .settings-toggle {
    display: inline-block;
  }

  .builder-main {
    grid-template-columns: minmax(0, 1fr);
  }

  .panel {
    display: none;
    position: fixed;
    inset: 3rem 0 0;
    z-index: 40;
    background: var(--color-bg, #fff);
  }

  .panel.open {
    display: block;
  }
}

.print-only {
  display: none;
}

/* Only the chosen view prints */
@media print {
  .builder-bar,
  .panel,
  .tray,
  .add-room,
  .pending,
  .message,
  .print-hidden {
    display: none !important;
  }

  .print-only {
    display: block;
  }

  .builder-main {
    display: block;
  }
}

.view-toggle button[aria-pressed='true'] {
  font-weight: 600;
}

.message {
  color: var(--color-warn, #a60);
}

.tray {
  margin-top: 1rem;
}

.empty {
  color: var(--color-text-muted, #666);
}
</style>
