<script setup lang="ts">
import '../builder/builder.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { ChoiceDialog, ScheduleBasic, ScheduleSheet } from '@qzr/ui'
import { seatText, type ScheduleDocument, type SheetView } from '@qzr/shared'

import {
  addDay,
  addEvent,
  addQuiz,
  addRoom,
  moveEvent,
  moveQuiz,
  swapSeats,
  unpinAll,
} from '../builder/edits'
import { keepSchedule, loadSchedule, saveScheduleFile } from '../builder/persistence'
import ElimSection from '../components/builder/ElimSection.vue'
import FrameSection from '../components/builder/FrameSection.vue'
import PrelimSection from '../components/builder/PrelimSection.vue'
import BuilderPopover from '../components/builder/BuilderPopover.vue'
import EventMenu from '../components/builder/EventMenu.vue'
import QuizMenu from '../components/builder/QuizMenu.vue'
import RoomMenu from '../components/builder/RoomMenu.vue'
import RowMenu from '../components/builder/RowMenu.vue'
import TeamsSection from '../components/builder/TeamsSection.vue'
import { useScheduleBuilder } from '../composables/useScheduleBuilder'

/**
 * A schedule kept in this browser, by id; without one, a new schedule. A linked schedule's page
 * passes the result names that have results, to protect their quizzes (H-20).
 */
const props = defineProps<{ id?: string; results?: string[]; initial?: ScheduleDocument }>()
const emit = defineEmits<{ changed: [doc: ScheduleDocument] }>()
// A linked schedule's page hands over the draft it holds, so it opens even when storage can't keep it
const kept = props.initial ?? (props.id ? loadSchedule(props.id) : null)
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
  held,
  confirmHeld,
  dropHeld,
} = useScheduleBuilder(
  kept ?? undefined,
  computed(() => new Set(props.results ?? [])),
)
defineExpose({ change, changeSettings, setAutoApply })

const heldLabels = computed(() =>
  (held.value?.quizzes ?? []).map((id) => doc.value.quizzes.find((q) => q.id === id)?.label ?? id),
)

/** The popup open on the grid, if any: one at a time (FR-005c) */
type Popup =
  | { kind: 'quiz'; id: string; anchor: HTMLElement; seat?: number }
  | { kind: 'event'; id: string; anchor: HTMLElement }
  | { kind: 'row'; id: string; anchor: HTMLElement }
  | { kind: 'room'; id: string; anchor: HTMLElement }
  | { kind: 'cell'; slot: string; room: string; anchor: HTMLElement }
const popup = ref<Popup | null>(null)

/** A quiz or an event, which move the same way (FR-017) */
type Item = 'quiz' | 'event'

/** A move or seat swap waiting for its target, chosen by click, tap or keyboard (FR-005a) */
type Pending =
  | { kind: 'move'; id: string; item: Item }
  | { kind: 'seat'; id: string; index: number }
const pending = ref<Pending | null>(null)

type Cell = { slot: string; room: string } | null

/** Move a quiz or an event to a cell, or to the tray with null; a quiz there swaps back */
function moveItem(item: Item, id: string, cell: Cell) {
  change((d) => (item === 'quiz' ? moveQuiz(d, id, cell) : moveEvent(d, id, cell)))
}

/** The cell an event starts in: its slot and its first room */
function eventCell(id: string): Cell {
  const e = doc.value.events.find((x) => x.id === id)
  if (!e?.slot) return null
  const room = e.rooms === 'all' ? doc.value.rooms[0]?.id : e.rooms[0]
  return room ? { slot: e.slot, room } : null
}

function onQuiz(id: string, anchor: HTMLElement) {
  const p = pending.value
  if (p?.kind === 'move') {
    const target = doc.value.quizzes.find((q) => q.id === id)
    pending.value = null
    if (p.id !== id && target?.cell) moveItem(p.item, p.id, target.cell)
    return
  }
  popup.value = { kind: 'quiz', id, anchor }
}

function onEvent(id: string, anchor: HTMLElement) {
  const p = pending.value
  if (p?.kind === 'move') {
    pending.value = null
    const cell = eventCell(id)
    if (p.id !== id && cell) moveItem(p.item, p.id, cell)
    return
  }
  popup.value = { kind: 'event', id, anchor }
}

/** Open a quiz's or an event's menu once it's drawn, on the grid or in Unplaced */
async function openMenu(kind: 'quiz' | 'event', id: string) {
  await nextTick()
  const anchor = document.querySelector<HTMLElement>(
    kind === 'quiz'
      ? `[data-quiz="${id}"] .tray-quiz, [data-quiz="${id}"] .quiz-title`
      : `[data-event="${id}"]`,
  )
  popup.value = anchor ? { kind, id, anchor } : null
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

/** An empty cell takes what's being moved, or else offers to add a quiz or an event there */
function onCell(slot: string, room: string, anchor: HTMLElement) {
  const p = pending.value
  if (p?.kind === 'move') {
    pending.value = null
    moveItem(p.item, p.id, { slot, room })
    return
  }
  popup.value = { kind: 'cell', slot, room, anchor }
}

/** Add a quiz or an event in the cell offered, and open its menu */
function addInCell(kind: Item) {
  const p = popup.value
  if (p?.kind !== 'cell') return
  let id = ''
  const cell = { slot: p.slot, room: p.room }
  change((d) => (id = kind === 'quiz' ? addQuiz(d, cell) : addEvent(d, cell)))
  void openMenu(kind, id)
}

function startMove(id: string, item: Item = 'quiz') {
  popup.value = null
  pending.value = { kind: 'move', id, item }
}

function startSeatSwap(id: string, index: number) {
  popup.value = null
  pending.value = { kind: 'seat', id, index }
}

function toTray() {
  const p = pending.value
  if (p?.kind !== 'move') return
  pending.value = null
  moveItem(p.item, p.id, null)
}

// Dragging, with pointer events (the HTML5 drag API crashes Tauri on Linux): a quiz onto a cell,
// another quiz or the tray, or a seat onto another seat
let drag: {
  id: string
  item: Item
  seat: number | null
  x: number
  y: number
  on: boolean
} | null = null
let dragged = false

/** What a drag carries, shown beside the pointer, and the target under it */
const ghost = ref<{ text: string; x: number; y: number; seat: boolean } | null>(null)
let dropOver: HTMLElement | null = null

/** Which drop targets to outline: wherever a move or swap, by click or by drag, can land */
const guide = computed(() =>
  pending.value?.kind === 'move'
    ? 'quiz'
    : pending.value?.kind === 'seat'
      ? 'seat'
      : ghost.value
        ? ghost.value.seat
          ? 'seat'
          : 'quiz'
        : null,
)

function markDrop(el: HTMLElement | null) {
  if (el === dropOver) return
  dropOver?.classList.remove('drop-over')
  el?.classList.add('drop-over')
  dropOver = el
}

function dropTarget(over: Element | null, seat: boolean) {
  if (!over) return null
  if (seat) return over.closest<HTMLElement>('[data-seat]')
  return over.closest<HTMLElement>('.empty-cell, .quiz, [data-event], .tray')
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const el = event.target as HTMLElement
  const seat = el.closest<HTMLElement>('[data-seat]')
  const quiz = el.closest<HTMLElement>('[data-quiz]')
  const ev = el.closest<HTMLElement>('[data-event]')
  if (!quiz && !ev) return
  const [, index] = seat?.dataset.seat?.split(':') ?? []
  drag = {
    id: quiz ? quiz.dataset.quiz! : ev!.dataset.event!,
    item: quiz ? 'quiz' : 'event',
    seat: index === undefined ? null : Number(index),
    x: event.clientX,
    y: event.clientY,
    on: false,
  }
}

function onPointerMove(event: PointerEvent) {
  if (!drag) return
  if (!drag.on) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return
    drag.on = true
  }
  const q = doc.value.quizzes.find((x) => x.id === drag!.id)
  const seat = drag.seat === null ? null : q?.seats[drag.seat]
  const label =
    drag.item === 'quiz' ? q?.label : doc.value.events.find((x) => x.id === drag!.id)?.label
  ghost.value = {
    text: seat && q ? seatText(doc.value, q, seat, view.value) : (label ?? ''),
    x: event.clientX,
    y: event.clientY,
    seat: drag.seat !== null,
  }
  markDrop(dropTarget(document.elementFromPoint(event.clientX, event.clientY), drag.seat !== null))
}

function onPointerUp(event: PointerEvent) {
  const d = drag
  drag = null
  ghost.value = null
  markDrop(null)
  if (!d?.on) return
  dragged = true
  setTimeout(() => (dragged = false))
  const over = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
  if (!over) return
  if (d.seat !== null) {
    const target = over.closest<HTMLElement>('[data-seat]')?.dataset.seat?.split(':')
    if (target && (target[0] !== d.id || Number(target[1]) !== d.seat)) {
      change((x) => swapSeats(x, d.id, d.seat!, target[0]!, Number(target[1])))
    }
    return
  }
  const onQuiz = over.closest<HTMLElement>('[data-quiz]')?.dataset.quiz
  const onEventEl = over.closest<HTMLElement>('[data-event]')?.dataset.event
  const onCell = over.closest<HTMLElement>('[data-cell]')?.dataset.cell?.split('|')
  if (over.closest('.tray')) moveItem(d.item, d.id, null)
  else if (onQuiz && onQuiz !== d.id) {
    const target = doc.value.quizzes.find((q) => q.id === onQuiz)
    if (target?.cell) moveItem(d.item, d.id, target.cell)
  } else if (onEventEl && onEventEl !== d.id) {
    const cell = eventCell(onEventEl)
    if (cell) moveItem(d.item, d.id, cell)
  } else if (onCell && onEventEl !== d.id) {
    moveItem(d.item, d.id, { slot: onCell[0]!, room: onCell[1]! })
  }
}

/** A click that ends a drag isn't a click */
function swallowAfterDrag(event: Event) {
  if (dragged) event.stopPropagation()
}

/** On a phone the settings open as a sheet over the grid (FR-005b) */
const panelOpen = ref(false)

// Every change is kept in this browser at once (FR-002)
const keepFailed = ref(false)

/** Quizzes the director has pinned; unpinning them all hands the grid back to the generator */
const pinnedCount = computed(() => doc.value.quizzes.filter((q) => q.pinned).length)

/** A save to file that failed says why, since the director is relying on that copy */
const fileError = ref('')
async function saveFile() {
  fileError.value = ''
  try {
    await saveScheduleFile(doc.value)
  } catch (e) {
    fileError.value = e instanceof Error ? e.message : String(e)
  }
}
watch(
  doc,
  (d, before) => {
    // A schedule opened in place of a missing one is new: kept from its first change, so
    // revisiting a stale link doesn't leave an empty schedule behind each time
    if (missing && !before) return
    keepFailed.value = !keepSchedule(d)
    // The document the builder opened with isn't a change
    if (before) emit('changed', d)
  },
  { immediate: true },
)

/** Letters, or drawn teams once a division has a draw (FR-043) */
const view = ref<SheetView>('letters')
const anyDrawn = computed(() =>
  Object.values(doc.value.draw).some((d) => d.teams.some((t) => t.letter)),
)

/** Print the room grid or the basic schedule (FR-044) */
const printing = ref<'grid' | 'basic'>('grid')
async function print(kind: 'grid' | 'basic') {
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
const trayEvents = computed(() => doc.value.events.filter((e) => !e.slot))

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
  <div class="builder" :class="[`print-${printing}`, guide && `guide-${guide}`]">
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
      <slot name="bar" :doc="doc" />
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
          (print(($event.target as HTMLSelectElement).value as 'grid' | 'basic'),
          (($event.target as HTMLSelectElement).value = ''))
        "
      >
        <option value="" disabled>Print…</option>
        <option value="grid">Room grid</option>
        <option value="basic">Basic schedule</option>
      </select>
      <button type="button" class="save-file" @click="saveFile">Save to file</button>
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
          <div v-if="pinnedCount > 0" class="pins">
            {{ pinnedCount }} pinned
            <button type="button" @click="changeSettings(unpinAll)">Unpin all</button>
          </div>
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
              @edit="change"
            />
            <ElimSection
              v-else-if="s.key === 'elims'"
              :doc="doc"
              :unapplied="unapplied"
              @change="changeSettings"
              @edit="change"
            />
            <PrelimSection
              v-else-if="s.key === 'prelims'"
              :doc="doc"
              :unapplied="unapplied"
              @change="changeSettings"
              @edit="change"
            />
          </div>
        </section>
      </aside>

      <!-- Drags start on the grid or in Unplaced, and end on either -->
      <main
        class="grid-area"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @click.capture="swallowAfterDrag"
      >
        <p v-if="missing" class="message" role="status">
          This schedule isn't in this browser any more; its stored data may have been cleared. Open
          it from a file if you saved one.
        </p>
        <p v-if="fileError" class="message" role="alert">The file wasn't saved: {{ fileError }}</p>
        <p v-if="keepFailed" class="message" role="status">
          This browser couldn't keep the schedule. Save it to a file so nothing is lost.
        </p>
        <div v-if="held" class="message held" role="alert">
          <p>
            {{ heldLabels.join(', ') }} {{ heldLabels.length === 1 ? 'has' : 'have' }} results
            already. Change {{ heldLabels.length === 1 ? 'it' : 'them' }} anyway? The schedule will
            mark {{ heldLabels.length === 1 ? 'it' : 'them' }} as changed after results.
          </p>
          <button type="button" @click="confirmHeld">Change anyway</button>
          <button type="button" @click="dropHeld">Cancel</button>
        </div>
        <slot name="notices" />
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
        <div class="sheet-wrap">
          <ScheduleSheet
            v-if="doc.rooms.length > 0"
            :class="{ 'print-hidden': printing !== 'grid' }"
            :doc="doc"
            :view="view"
            :issues="issues"
            :selected="pending?.kind === 'move' ? pending.id : null"
            editable
            @quiz="onQuiz"
            @seat="onSeat"
            @cell="onCell"
            @event="onEvent"
            @row="(id, el) => (popup = { kind: 'row', id, anchor: el })"
            @room="(id, el) => (popup = { kind: 'room', id, anchor: el })"
          >
            <template #rooms-end>
              <button type="button" class="add-room" @click="change((d) => addRoom(d))">
                + Room
              </button>
            </template>
            <template #days-end>
              <button type="button" class="add-day" @click="change((d) => addDay(d))">+ Day</button>
            </template>
          </ScheduleSheet>
        </div>
        <section
          v-if="tray.length + trayEvents.length > 0"
          class="tray"
          aria-label="Unplaced quizzes"
        >
          <h3>
            Unplaced <span class="count">{{ tray.length + trayEvents.length }}</span>
          </h3>
          <ul>
            <li v-for="e in trayEvents" :key="e.id" class="tray-card tray-event">
              <button
                type="button"
                class="tray-quiz"
                :data-event="e.id"
                @click="onEvent(e.id, $event.currentTarget as HTMLElement)"
              >
                {{ e.label }}
              </button>
              <small>Event</small>
            </li>
            <li v-for="q in tray" :key="q.id" class="tray-card" :data-quiz="q.id">
              <button
                type="button"
                class="tray-quiz"
                @click="onQuiz(q.id, $event.currentTarget as HTMLElement)"
              >
                {{ q.label }}
              </button>
              <button
                v-for="(seat, i) in q.seats"
                :key="i"
                type="button"
                class="tray-seat"
                :data-seat="`${q.id}:${i}`"
                @click="onSeat(q.id, i, $event.currentTarget as HTMLElement)"
              >
                <span class="src">{{ seatText(doc, q, seat, 'letters') }}</span>
                <span class="bench" :class="`bench-${i}`" />
                <span class="line">{{
                  view === 'teams' && seat.kind === 'letter' ? seatText(doc, q, seat, 'teams') : ''
                }}</span>
              </button>
              <small>{{ (issues.get(q.id) ?? []).map((c) => c.reason).join('; ') }}</small>
            </li>
          </ul>
        </section>
      </main>
    </div>
    <div
      v-if="ghost"
      class="drag-ghost"
      :style="{ left: `${ghost.x + 12}px`, top: `${ghost.y + 12}px` }"
      aria-hidden="true"
    >
      {{ ghost.text }}
    </div>
    <div class="print-only">
      <h2>{{ doc.name }}</h2>
      <ScheduleBasic v-if="printing === 'basic'" :doc="doc" />
    </div>
    <QuizMenu
      v-if="popup?.kind === 'quiz'"
      :key="popup.id"
      :doc="doc"
      :quiz-id="popup.id"
      :anchor="popup.anchor"
      :seat="popup.seat ?? null"
      :view="view"
      @change="change"
      @close="popup = null"
      @move="startMove"
      @swap-seat="startSeatSwap"
      @event="(id) => openMenu('event', id)"
    />
    <EventMenu
      v-else-if="popup?.kind === 'event'"
      :key="popup.id"
      :doc="doc"
      :event-id="popup.id"
      :anchor="popup.anchor"
      @change="change"
      @close="popup = null"
      @move="(id) => startMove(id, 'event')"
      @quiz="(id) => openMenu('quiz', id)"
    />
    <BuilderPopover
      v-else-if="popup?.kind === 'cell'"
      :anchor="popup.anchor"
      title="Add here"
      tag="Empty cell"
      @close="popup = null"
    >
      <div class="add-choice">
        <button type="button" @click="addInCell('quiz')">Quiz</button>
        <button type="button" @click="addInCell('event')">Event</button>
      </div>
    </BuilderPopover>
    <RowMenu
      v-else-if="popup?.kind === 'row'"
      :doc="doc"
      :row-id="popup.id"
      :anchor="popup.anchor"
      @change="change"
      @settings="changeSettings"
      @close="popup = null"
    />
    <RoomMenu
      v-else-if="popup?.kind === 'room'"
      :doc="doc"
      :room-id="popup.id"
      :anchor="popup.anchor"
      @change="change"
      @settings="changeSettings"
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

/* The builder's toolbar, drawn like the scoresheet's: a raised panel with a gold edge */
.builder-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0.6rem 0.75rem 0;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--color-meta-accent);
  border-left: 3px solid var(--color-meta-border);
  border-radius: 6px;
  background: var(--color-meta-bg);
}

.builder-bar .schedule-name {
  min-width: 12rem;
  border-color: transparent;
  background: transparent;
  color: var(--color-heading);
  font-size: 0.95rem;
  font-weight: 650;
}

.builder-bar .schedule-name:hover {
  border-color: var(--color-meta-accent);
}

/* Letters or teams, as one control */
.view-toggle {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border: 1px solid var(--color-meta-accent);
  border-radius: 5px;
}

.view-toggle button {
  border-color: transparent;
  background: transparent;
}

.view-toggle button[aria-pressed='true'] {
  border-color: var(--color-meta-accent);
  background: var(--color-bg);
  color: var(--color-text);
}

/* The count of problems reads as a status, red while there are any */
.issue-count:not(:disabled) {
  border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
  background: var(--color-danger-bg);
  color: var(--color-danger);
}

.spacer {
  flex: 1;
}

.builder-main {
  flex: 1;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  min-height: 0;
  margin-top: 0.6rem;
  border-top: 1px solid var(--color-border-alt);
}

/* The settings rail stays in view while the grid scrolls */
.panel {
  position: sticky;
  top: 0;
  align-self: start;
  max-height: 100vh;
  overflow-y: auto;
  border-right: 1px solid var(--color-border-alt);
  background: var(--color-bg);
}

.panel .section-head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.6rem;
  width: 100%;
  padding: 0.75rem 1rem;
  border: 0;
  border-bottom: 1px solid var(--color-border-alt);
  border-left: 3px solid transparent;
  border-radius: 0;
  background: none;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-align: left;
  text-transform: uppercase;
}

/* A chevron saying the section opens, turned down while it's open */
.panel .section-head::before {
  content: '';
  flex: none;
  width: 0.45rem;
  height: 0.45rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform 0.15s;
}

.panel .section-head .count {
  margin-left: auto;
}

.panel .section-head:hover:not(:disabled) {
  background: var(--color-meta-bg);
  color: var(--color-text);
}

/* The open section: its header and body drawn as one panel with the scoresheet's gold edge */
.panel .section-head[aria-expanded='true'] {
  border-bottom-color: transparent;
  border-left-color: var(--color-meta-border);
  background: var(--color-meta-bg);
  color: var(--color-heading);
  font-weight: 700;
}

.panel .section-head[aria-expanded='true']::before {
  transform: rotate(45deg) translate(-2px, -2px);
}

.section-body {
  display: grid;
  gap: 0.6rem;
  padding: 0.25rem 1rem 1rem calc(1rem - 3px);
  border-bottom: 1px solid var(--color-border-alt);
  border-left: 3px solid var(--color-meta-border);
  background: color-mix(in srgb, var(--color-meta-bg) 45%, var(--color-bg));
}

/* Not a scroll box of its own: the page scrolls, so the room headers and Unplaced can stick */
.grid-area {
  padding: 0.75rem;
  background: var(--color-bg-warm);
}

.auto-apply {
  display: grid;
  gap: 0.35rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border-alt);
}

.auto-apply label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}

.apply-bar,
.pins {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.35rem 0.35rem 0.6rem;
  border-radius: 5px;
  font-size: 0.8rem;
}

.apply-bar {
  background: var(--color-warn-bg);
  color: var(--color-warn);
  font-weight: 600;
}

.pins {
  background: var(--color-meta-bg);
  color: var(--color-text-muted);
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

/* Only the chosen view prints, starting at the top of the page */
@media print {
  .builder-bar,
  .panel,
  .tray,
  .add-room,
  .add-day,
  .pending,
  .message,
  .empty,
  .print-hidden,
  .print-basic .grid-area {
    display: none !important;
  }

  .print-only {
    display: block;
  }

  .builder,
  .builder-main {
    display: block;
    min-height: 0;
    margin: 0;
    border: 0;
  }

  .grid-area {
    overflow: visible;
    padding: 0;
    background: none;
  }

  .print-grid .print-only {
    display: none;
  }
}

.view-toggle button[aria-pressed='true'] {
  font-weight: 600;
}

.message {
  color: var(--color-warn, #a60);
}

/* Always in view while anything waits to be placed */
.tray {
  position: sticky;
  bottom: 0;
  z-index: 3;
  display: grid;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--color-meta-accent);
  border-top: 3px solid var(--color-warn);
  border-radius: var(--b-radius) var(--b-radius) 0 0;
  background: var(--color-bg);
  box-shadow: var(--b-shadow-lift);
}

.tray h3 {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-heading);
}

.tray ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  max-height: 14rem;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

/* An unplaced quiz drawn as on the grid: its title over its ruled seats */
.tray-card {
  display: grid;
  justify-items: center;
  gap: 0.15rem;
  width: 13.5rem;
  padding: 0.35rem 0.5rem 0.4rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 5px;
  background: var(--color-bg);
  cursor: grab;
}

.builder .tray-card button {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
}

.builder .tray-card .tray-quiz {
  color: var(--color-heading);
  font-weight: 700;
}

/* Seats as the grid draws them: the line centred under the title, the source and bench colour
   (red, white, blue) just left of it */
.builder .tray-card .tray-seat {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 3px 5rem minmax(0, 1fr);
  align-items: end;
  width: 100%;
  column-gap: 0.3rem;
  color: var(--color-text);
  font-size: 0.8rem;
  line-height: 1.25;
}

.tray-seat .src {
  justify-self: end;
  font-family: var(--b-mono);
  font-weight: 600;
  white-space: nowrap;
}

.tray-seat .bench {
  height: 1em;
  margin-bottom: 0.15em;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text) 25%, transparent);
}

.tray-seat .bench-0 {
  background: #e02424;
}

.tray-seat .bench-1 {
  background: #fff;
}

.tray-seat .bench-2 {
  background: #1d4ed8;
}

.tray-seat .line {
  min-height: 1.2em;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--color-text) 30%, transparent);
  font-weight: 600;
  white-space: nowrap;
}

.builder .tray-card button:hover {
  background: var(--color-meta-bg);
  color: var(--color-accent);
}

.tray-card small {
  color: var(--color-text-muted);
  font-size: 0.72rem;
}

.empty {
  color: var(--color-text-muted, #666);
}

/* Drop guides: while a quiz or seat is being moved, by click or drag, every place it can go is
   outlined in blue, and the one under the pointer filled */
.guide-quiz :deep(.empty-cell),
.guide-quiz :deep(.quiz:not(.selected)),
.guide-quiz .tray,
.guide-seat :deep(.seat),
.guide-seat .tray-seat {
  outline: 1.5px dashed color-mix(in srgb, var(--color-accent) 70%, transparent);
  outline-offset: -2px;
}

.guide-quiz :deep(.empty-cell) {
  background: color-mix(in srgb, var(--color-accent) 7%, transparent);
}

.guide-quiz :deep(:is(.empty-cell, .quiz):hover),
.guide-seat :deep(.seat:hover),
.guide-seat .tray-seat:hover,
.builder :deep(.drop-over) {
  outline: 2px solid var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.guide-quiz :deep(.quiz.selected) {
  opacity: 0.55;
}

.drag-ghost {
  position: fixed;
  z-index: 60;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  background: var(--color-bg);
  box-shadow: var(--b-shadow-lift);
  color: var(--color-heading);
  font-size: 0.8rem;
  font-weight: 600;
  pointer-events: none;
}
.add-choice {
  display: flex;
  gap: 0.4rem;
}

.add-choice button {
  flex: 1;
}

.tray-event {
  border-style: dashed;
}
</style>
