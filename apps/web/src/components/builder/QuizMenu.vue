<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { seatText, type ScheduleDocument, type Seat } from '@qzr/shared'

import { deleteQuiz, moveQuiz, renameQuiz, setPinned, setSeat } from '../../builder/edits'
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
}>()
const emit = defineEmits<{
  change: [mutate: (d: ScheduleDocument) => void]
  close: []
  /** Start moving this quiz: the next cell or quiz chosen is where it goes */
  move: [id: string]
  /** Start swapping this seat: the next seat chosen swaps with it */
  swapSeat: [id: string, index: number]
}>()

const q = computed(() => props.doc.quizzes.find((x) => x.id === props.quizId)!)
const editing = ref<number | null>(props.seat ?? null)

const SEAT_KINDS: { kind: Seat['kind']; label: string }[] = [
  { kind: 'letter', label: 'Prelim letter' },
  { kind: 'rank', label: 'Prelim rank' },
  { kind: 'new', label: 'New (intermediate result)' },
  { kind: 'place', label: 'Place in a quiz' },
  { kind: 'points', label: 'Place in points' },
  { kind: 'empty', label: 'Empty' },
]

const editingSeat = computed(() => (editing.value === null ? null : q.value.seats[editing.value]!))
const kind = ref<Seat['kind']>(editingSeat.value?.kind ?? 'letter')

function openSeat(i: number) {
  editing.value = i
  kind.value = q.value.seats[i]!.kind
}

// Choosing a seat on the grid while the menu is open opens that seat's editor
watch(
  () => props.seat,
  (i) => {
    if (i !== null && i !== undefined) openSeat(i)
  },
)

/** The seat as the inputs describe it, or null while they don't describe one yet */
function readSeat(form: HTMLFormElement): Seat | null {
  const value = (name: string) =>
    (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? ''
  const n = Math.floor(Number(value('number')))
  switch (kind.value) {
    case 'letter':
      return /^[A-Z]+$/.test(value('letter').toUpperCase())
        ? { kind: 'letter', letter: value('letter').toUpperCase() }
        : null
    case 'rank':
    case 'new':
      return n >= 1 ? { kind: kind.value, rank: n } : null
    case 'points':
      return n >= 1 ? { kind: 'points', place: n } : null
    case 'place':
      return n >= 1 && value('quiz') ? { kind: 'place', place: n, quiz: value('quiz') } : null
    case 'empty':
      return { kind: 'empty' }
  }
}

function saveSeat(event: Event) {
  const next = readSeat(event.target as HTMLFormElement)
  const i = editing.value
  if (!next || i === null) return
  emit('change', (d) => setSeat(d, props.quizId, i, next))
  editing.value = null
}

function rename(event: Event) {
  const label = (event.target as HTMLInputElement).value.trim()
  if (label && label !== q.value.label) emit('change', (d) => renameQuiz(d, props.quizId, label))
}

const others = computed(() => props.doc.quizzes.filter((x) => x.id !== props.quizId))
const current = (key: 'letter' | 'number' | 'quiz') => {
  const s = editingSeat.value
  if (!s) return ''
  if (key === 'letter') return s.kind === 'letter' ? s.letter : ''
  if (key === 'quiz') return s.kind === 'place' ? s.quiz : ''
  return s.kind === 'rank' || s.kind === 'new'
    ? String(s.rank)
    : s.kind === 'place' || s.kind === 'points'
      ? String(s.place)
      : ''
}
</script>

<template>
  <BuilderPopover :anchor="anchor" :title="q.label" @close="emit('close')">
    <template v-if="editing === null">
      <label class="field">
        Name
        <input :value="q.label" aria-label="Quiz name" @change="rename" />
      </label>
      <div class="seats">
        <button
          v-for="(s, i) in q.seats"
          :key="i"
          type="button"
          class="seat-row"
          :aria-label="`Seat ${i + 1}`"
          @click="openSeat(i)"
        >
          {{ seatText(doc, q, s, 'letters') }} ›
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
        <button
          type="button"
          class="danger"
          @click="(emit('change', (d) => deleteQuiz(d, quizId)), emit('close'))"
        >
          Delete
        </button>
      </div>
    </template>

    <form v-else class="seat-editor" @submit.prevent="saveSeat">
      <button type="button" class="back" @click="editing = null">‹ Back</button>
      <p class="now">
        Seat {{ editing + 1 }} · now {{ seatText(doc, q, editingSeat!, 'letters') }}
      </p>
      <select v-model="kind" aria-label="Seat kind">
        <option v-for="k in SEAT_KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option>
      </select>
      <input
        v-if="kind === 'letter'"
        name="letter"
        :value="current('letter')"
        aria-label="Letter"
        autocomplete="off"
      />
      <input
        v-if="kind === 'rank' || kind === 'new' || kind === 'place' || kind === 'points'"
        name="number"
        type="number"
        min="1"
        :value="current('number')"
        :aria-label="kind === 'place' || kind === 'points' ? 'Place' : 'Rank'"
      />
      <select v-if="kind === 'place'" name="quiz" :value="current('quiz')" aria-label="Of quiz">
        <option v-for="o in others" :key="o.id" :value="o.id">{{ o.label }}</option>
      </select>
      <div class="actions">
        <button type="submit">Set seat</button>
        <button type="button" @click="emit('swapSeat', quizId, editing!)">
          Swap with another seat
        </button>
      </div>
    </form>
  </BuilderPopover>
</template>

<style scoped>
.field {
  display: grid;
  gap: 0.25rem;
}

.seats,
.seat-editor {
  display: grid;
  gap: 0.25rem;
}

.seat-row {
  text-align: left;
  font: inherit;
  background: none;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 6px;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.back {
  justify-self: start;
  font: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.now {
  margin: 0;
  font-size: 0.85rem;
}

.danger {
  color: var(--color-danger, #c33);
}
</style>
