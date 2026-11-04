<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  formatClock,
  indexOfLetter,
  letterOf,
  ordinal,
  quizNumber,
  seatText,
  type ScheduleDocument,
  type ScheduleQuiz,
  type Seat,
  type SheetView,
} from '@qzr/shared'

import {
  deleteQuiz,
  moveQuiz,
  quizToEvent,
  renameQuiz,
  setPinned,
  setSeat,
} from '../../builder/edits'
import BuilderPopover from './BuilderPopover.vue'

/**
 * A quiz's menu on the grid: rename, its seats, move, move to the unplaced tray, pin or unpin, and
 * delete (FR-005c). A seat's editor sets any kind of source and leads back here.
 */
const props = defineProps<{
  doc: ScheduleDocument
  quizId: string
  anchor: HTMLElement
  /** Open straight on a seat's editor */
  seat?: number | null
  view?: SheetView
}>()
const emit = defineEmits<{
  change: [mutate: (d: ScheduleDocument) => void]
  close: []
  /** Start moving this quiz: the next cell or quiz chosen is where it goes */
  move: [id: string]
  /** Start swapping this seat: the next seat chosen swaps with it */
  swapSeat: [id: string, index: number]
  /** It became an event, whose menu opens in its place */
  event: [id: string]
}>()

function toEvent() {
  let id = ''
  emit('change', (d) => (id = quizToEvent(d, props.quizId)))
  emit('event', id)
}

const q = computed(() => props.doc.quizzes.find((x) => x.id === props.quizId)!)
const exists = computed(() => props.doc.quizzes.some((x) => x.id === props.quizId))
const editing = ref<number | null>(props.seat ?? null)

/** In Teams view, a drawn division's letters are picked by team (FR-043) */
const drawnLetters = computed(() => {
  if (props.view !== 'teams') return null
  const teams = props.doc.draw[q.value.division]?.teams ?? []
  const named = teams
    .map((t, i) => ({ letter: t.letter, name: t.name ?? `Team ${i + 1}` }))
    .filter((t): t is { letter: string; name: string } => !!t.letter)
    .sort((a, b) => indexOfLetter(a.letter) - indexOfLetter(b.letter))
  return named.length > 0 ? named : null
})

/** The seat editor's tabs: where the seat's team comes from */
type Tab = 'letter' | 'rank' | 'place' | 'points'
const TABS: { tab: Tab; label: string }[] = [
  { tab: 'letter', label: 'Letter' },
  { tab: 'rank', label: 'Rank' },
  { tab: 'place', label: 'From quiz' },
  { tab: 'points', label: 'Points' },
]

const editingSeat = computed(() => (editing.value === null ? null : q.value.seats[editing.value]!))
/** A New rank is a rank after an intermediate, so it sits on the Rank tab */
const defaultTab = (seat: Seat | null): Tab =>
  !seat || seat.kind === 'empty'
    ? q.value.phase === 'prelim'
      ? 'letter'
      : 'place'
    : seat.kind === 'new'
      ? 'rank'
      : seat.kind
const tab = ref<Tab>(defaultTab(editingSeat.value))

function openSeat(i: number) {
  editing.value = i
  tab.value = defaultTab(q.value.seats[i]!)
}

// Choosing a seat on the grid while the menu is open opens that seat's editor
watch(
  () => props.seat,
  (i) => {
    if (i !== null && i !== undefined) openSeat(i)
  },
)

const division = computed(() => props.doc.settings.divisions.find((d) => d.id === q.value.division))
/** The division's colour, as the grid ticks its quizzes */
const colour = computed(() => {
  const i = props.doc.settings.divisions.findIndex((d) => d.id === q.value.division)
  return i < 0 ? undefined : `var(--b-d${(i % 4) + 1})`
})
const teams = computed(() => division.value?.teams ?? 0)
const sameDivision = computed(() =>
  props.doc.quizzes.filter((x) => x.division === q.value.division && x.id !== props.quizId),
)
const hasRoundRobin = computed(
  () => division.value?.elims.lanes.some((l) => l.format === 'roundRobin') ?? false,
)
const tabs = computed(() => TABS.filter((t) => t.tab !== 'points' || hasRoundRobin.value))

const slotAt = computed(() => {
  const at = new Map<string, { order: number; minutes: number }>()
  props.doc.frame.forEach((r, i) => {
    if (r.kind === 'slot') at.set(r.id, { order: i, minutes: r.at })
  })
  return at
})
const orderOf = (x: ScheduleQuiz) => (x.cell ? (slotAt.value.get(x.cell.slot)?.order ?? 1e9) : 1e9)

/** A choice on the editor: what it sets, what it shows, and a word on where it's already used */
interface Choice {
  key: string
  text: string
  sub: string
  seat: Seat
  /** Already used elsewhere, or busy at the same time: allowed, but worth a second look */
  warn: boolean
}

const same = (a: Seat | null, b: Seat) => !!a && JSON.stringify(a) === JSON.stringify(b)
const usedIn = (seat: Seat) => sameDivision.value.find((x) => x.seats.some((s) => same(s, seat)))

const choices = computed<Choice[]>(() => {
  const n = teams.value
  const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1)
  const used = (seat: Seat, text: string): Choice => {
    const other = usedIn(seat)
    return {
      key: text,
      text,
      sub: other ? `in ${quizNumber(other)}` : '',
      seat,
      warn: !!other,
    }
  }
  switch (tab.value) {
    case 'letter': {
      const names = new Map(drawnLetters.value?.map((t) => [t.letter, t.name]))
      const slot = q.value.cell?.slot
      return range(n).map((i) => {
        const letter = letterOf(i - 1)
        const seat: Seat = { kind: 'letter', letter }
        const busy =
          !!slot &&
          sameDivision.value.some(
            (x) => x.cell?.slot === slot && x.seats.some((s) => same(s, seat)),
          )
        const plays = props.doc.quizzes.filter(
          (x) =>
            x.division === q.value.division &&
            x.phase === 'prelim' &&
            x.seats.some((s) => same(s, seat)),
        ).length
        const count = busy ? 'busy now' : `${plays} ${plays === 1 ? 'quiz' : 'quizzes'}`
        return {
          key: letter,
          text: letter,
          sub: [names.get(letter), count].filter(Boolean).join(' · '),
          seat,
          warn: busy,
        }
      })
    }
    case 'rank':
      return range(n).map((r) => used({ kind: 'rank', rank: r }, String(r)))
    case 'points': {
      const size = division.value?.elims.lanes[q.value.lane ?? 0]?.size ?? n
      return range(size).map((p) => used({ kind: 'points', place: p }, `${ordinal(p)} in pts`))
    }
  }
  // From quiz lists its sources instead
  return []
})

/** The ranks an intermediate settles, which can also be taken as they stand after it ("New n") */
const newChoices = computed<Choice[]>(() => {
  const d = division.value
  if (tab.value !== 'rank' || !d) return []
  const ranks = new Set<number>()
  let lineAt = 1
  d.elims.lanes.forEach((lane, i) => {
    lineAt += lane.size
    const inter = d.elims.lines[i]?.intermediate
    if (!inter) return
    const from = lineAt - inter.above
    for (let r = from; r < from + 3 * inter.quizzes; r++) ranks.add(r)
  })
  return [...ranks]
    .sort((a, b) => a - b)
    .map((r) => {
      const seat: Seat = { kind: 'new', rank: r }
      const other = usedIn(seat)
      return {
        key: `new${r}`,
        text: `New ${r}`,
        sub: other ? `in ${quizNumber(other)}` : '',
        seat,
        warn: !!other,
      }
    })
})

/** The division's other elims, earlier ones first; a seat from a later one breaks H-12 */
const sources = computed(() => {
  const mine = orderOf(q.value)
  const rows = sameDivision.value
    .filter((x) => x.phase === 'elim')
    .sort((a, b) => orderOf(a) - orderOf(b))
    .map((x) => ({
      quiz: x,
      when: x.cell ? formatClock(slotAt.value.get(x.cell.slot)?.minutes ?? 0) : 'Unplaced',
      places: [1, 2, 3].map((place) => {
        const seat: Seat = { kind: 'place', place, quiz: x.id }
        const other = usedIn(seat)
        return { place, seat, other: other ? quizNumber(other) : '' }
      }),
    }))
  return {
    earlier: rows.filter((r) => orderOf(r.quiz) < mine),
    later: rows.filter((r) => orderOf(r.quiz) >= mine),
  }
})

function setTo(seat: Seat) {
  const i = editing.value
  if (i === null) return
  emit('change', (d) => setSeat(d, props.quizId, i, seat))
  editing.value = null
}

/** Anything the choices don't list can be typed; nothing is refused (FR-035a) */
function setOther(event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim().toUpperCase()
  const n = Math.floor(Number(raw))
  if (tab.value === 'letter' && /^[A-Z]+$/.test(raw)) setTo({ kind: 'letter', letter: raw })
  else if (tab.value === 'rank') {
    // "New 12" (or "N12") for a rank after an intermediate, else a plain rank
    const after = /^N(?:EW)?\s*(\d+)$/.exec(raw)
    if (after) setTo({ kind: 'new', rank: Number(after[1]) })
    else if (n >= 1) setTo({ kind: 'rank', rank: n })
  } else if (tab.value === 'points' && n >= 1) setTo({ kind: 'points', place: n })
}

function rename(event: Event) {
  const label = (event.target as HTMLInputElement).value.trim()
  if (label && label !== q.value.label) emit('change', (d) => renameQuiz(d, props.quizId, label))
}
</script>

<template>
  <!-- Gone once turned into an event, until its menu opens in this one's place -->
  <BuilderPopover
    v-if="exists"
    :anchor="anchor"
    :title="q.label"
    :tag="division?.name ?? 'Quiz'"
    :colour="colour"
    @close="emit('close')"
  >
    <template v-if="editing === null">
      <label class="row">
        Name
        <input :value="q.label" aria-label="Quiz name" @change="rename" />
      </label>
      <div class="group">
        <h4 class="card-title">Seats</h4>
        <!-- Each seat as the grid draws it: its bench colour, its source, then its editor -->
        <button
          v-for="(s, i) in q.seats"
          :key="i"
          type="button"
          class="seat-row"
          :aria-label="`Seat ${i + 1}`"
          @click="openSeat(i)"
        >
          <span class="bench" :class="`bench-${i}`" />
          <span class="src" :class="{ choose: s.kind === 'empty' }">{{
            seatText(doc, q, s, view ?? 'letters')
          }}</span>
          <span class="go">›</span>
        </button>
      </div>
      <div class="actions">
        <button type="button" @click="emit('move', quizId)">Move</button>
        <button type="button" @click="emit('change', (d) => moveQuiz(d, quizId, null))">
          Move to Unplaced
        </button>
        <button type="button" @click="emit('change', (d) => setPinned(d, quizId, !q.pinned))">
          {{ q.pinned ? 'Unpin' : 'Pin' }}
        </button>
        <button type="button" @click="toEvent">Turn into event</button>
      </div>
      <div class="foot">
        <button
          type="button"
          class="danger"
          @click="(emit('change', (d) => deleteQuiz(d, quizId)), emit('close'))"
        >
          Delete
        </button>
      </div>
    </template>

    <div v-else class="seat-editor">
      <div class="seat-head">
        <button type="button" class="link" @click="editing = null">‹ Back</button>
        <h4 class="card-title">Seat {{ editing + 1 }}</h4>
        <span class="now">Now: {{ seatText(doc, q, editingSeat!, view ?? 'letters') }}</span>
      </div>
      <div class="seg" role="tablist" aria-label="Seat comes from">
        <button
          v-for="t in tabs"
          :key="t.tab"
          type="button"
          role="tab"
          :aria-selected="tab === t.tab"
          @click="tab = t.tab"
        >
          {{ t.label }}
        </button>
      </div>

      <div v-if="tab !== 'place'" class="choices">
        <button
          v-for="c in choices"
          :key="c.key"
          type="button"
          :class="{ on: same(editingSeat, c.seat), warn: c.warn }"
          :aria-pressed="same(editingSeat, c.seat)"
          @click="setTo(c.seat)"
        >
          {{ c.text }}<small v-if="c.sub">{{ c.sub }}</small>
        </button>
      </div>
      <template v-if="newChoices.length > 0">
        <h4>After the intermediate</h4>
        <div class="choices">
          <button
            v-for="c in newChoices"
            :key="c.key"
            type="button"
            :class="{ on: same(editingSeat, c.seat), warn: c.warn }"
            :aria-pressed="same(editingSeat, c.seat)"
            @click="setTo(c.seat)"
          >
            {{ c.text }}<small v-if="c.sub">{{ c.sub }}</small>
          </button>
        </div>
      </template>
      <label v-if="tab !== 'place'" class="other">
        Other
        <input
          :key="tab"
          :aria-label="`Other ${tab}`"
          :placeholder="tab === 'letter' ? 'Letter' : tab === 'rank' ? '12 or New 12' : 'Number'"
          autocomplete="off"
          @change="setOther"
        />
      </label>

      <div v-else class="sources">
        <p v-if="sources.earlier.length === 0" class="hint">No earlier elims in this division.</p>
        <div v-for="r in sources.earlier" :key="r.quiz.id" class="source">
          <span
            >{{ quizNumber(r.quiz) }}<small>{{ r.when }}</small></span
          >
          <button
            v-for="p in r.places"
            :key="p.place"
            type="button"
            :class="{ on: same(editingSeat, p.seat), warn: !!p.other }"
            :aria-label="`${ordinal(p.place)} of ${quizNumber(r.quiz)}`"
            @click="setTo(p.seat)"
          >
            {{ ordinal(p.place) }}<small v-if="p.other">→ {{ p.other }}</small>
          </button>
        </div>
        <details v-if="sources.later.length > 0">
          <summary>Later quizzes ({{ sources.later.length }}) · would break H-12</summary>
          <div v-for="r in sources.later" :key="r.quiz.id" class="source">
            <span
              >{{ quizNumber(r.quiz) }}<small>{{ r.when }}</small></span
            >
            <button
              v-for="p in r.places"
              :key="p.place"
              type="button"
              :class="{ on: same(editingSeat, p.seat), warn: true }"
              :aria-label="`${ordinal(p.place)} of ${quizNumber(r.quiz)}`"
              @click="setTo(p.seat)"
            >
              {{ ordinal(p.place) }}
            </button>
          </div>
        </details>
      </div>

      <div class="foot">
        <button type="button" @click="setTo({ kind: 'empty' })">Clear seat</button>
        <button type="button" @click="emit('swapSeat', quizId, editing!)">
          Swap with another seat
        </button>
      </div>
    </div>
  </BuilderPopover>
</template>

<style scoped>
.seat-editor {
  display: grid;
  gap: 0.45rem;
}

/* A seat as the grid draws it, a row to open */
.popover .seat-row {
  display: grid;
  grid-template-columns: 3px 1fr auto;
  justify-content: stretch;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  border-color: var(--color-border-alt);
  background: var(--color-bg);
  text-align: left;
}

.seat-row .bench {
  align-self: stretch;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text) 25%, transparent);
}

.bench-0 {
  background: #e02424;
}

.bench-1 {
  background: #fff;
}

.bench-2 {
  background: #1d4ed8;
}

.seat-row .src {
  color: var(--color-heading);
  font-family: var(--b-mono);
}

.seat-row .src.choose {
  color: var(--color-accent);
  font-family: inherit;
  font-style: italic;
}

.seat-row .go {
  color: var(--color-text-faint);
}

.seat-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.now {
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.seat-editor .seg {
  display: flex;
}

.seat-editor .seg button {
  flex: 1;
}

/* The tabs mark their choice as the settings' segmented toggles do */
.seat-editor .seg button[aria-selected='true'] {
  border-color: var(--color-meta-accent);
  background: var(--color-bg);
  color: var(--color-heading);
}

.choices {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(4.4rem, 1fr));
  gap: 0.25rem;
  max-height: 14rem;
  overflow-y: auto;
}

.seat-editor .choices button,
.seat-editor .source button {
  flex-direction: column;
  gap: 0;
  padding: 0.25rem;
  background: none;
  color: var(--color-heading);
  font-family: var(--b-mono);
}

.seat-editor :is(.choices, .source) small {
  color: var(--color-text-faint);
  font-family: inherit;
  font-size: 0.65rem;
  font-weight: 500;
}

.seat-editor :is(.choices, .source) button.warn {
  border-color: var(--color-warn);
  background: var(--color-warn-bg);
}

.seat-editor :is(.choices, .source) button.on {
  border-color: var(--color-accent);
  outline: 1px solid var(--color-accent);
}

.other {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.other input {
  width: 5rem;
}

.sources {
  display: grid;
  gap: 0.25rem;
  max-height: 16rem;
  overflow-y: auto;
}

.source {
  display: grid;
  grid-template-columns: 1fr repeat(3, 3.2rem);
  align-items: center;
  gap: 0.25rem;
}

.source > span {
  display: grid;
  color: var(--color-heading);
}

.source > span small {
  color: var(--color-text-faint);
  font-size: 0.7rem;
}

.sources summary {
  color: var(--color-text-muted);
  font-size: 0.8rem;
  cursor: pointer;
}

.hint {
  margin: 0;
}

.seat-editor h4 {
  margin: 0.25rem 0 0;
}
</style>
