<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'

import { quizName } from '@qzr/shared'

import {
  claimRecord,
  discardRecent,
  discardAllRecent,
  listRecent,
  readable,
  storedQuizFile,
  type QuizRecord,
  type RecordClaim,
  type StateKind,
} from '../persistence/autoSave'
import { confirmAction } from '../persistence/fileIO'

const props = defineProps<{
  /** Show a recent quiz the tab has just claimed, in one of its states */
  onRestore: (record: QuizRecord, claim: RecordClaim, state: StateKind) => void
  /** Open a copy of a newer version's quiz, which stays listed; true when it was opened */
  onOpenNewer: (record: QuizRecord) => Promise<boolean>
}>()

/** A row: one kept state of a quiz, as listed */
interface Row {
  key: string
  record: QuizRecord
  state: StateKind | 'newer'
  /** Which state it is, where it isn't simply the quiz as it was left */
  kind: string
  name: string
  teams: string
  answers: number
  when: string
}

const dialogRef = ref<HTMLDialogElement | null>(null)
/** Offer: quizzes left by closed tabs, shown to a new tab. List: every recent quiz. */
const form = ref<'offer' | 'list'>('list')
const records = shallowRef<QuizRecord[]>([])
/** Why the last restore didn't happen */
const taken = ref('')

// Unsaved quizzes first; a quiz's rows together, its current state first
const rows = computed<Row[]>(() =>
  [...records.value]
    .sort((a, b) => Number(b.unsaved) - Number(a.unsaved) || b.changedAt - a.changedAt)
    .flatMap(rowsOf),
)

function rowsOf(record: QuizRecord): Row[] {
  const row = (state: Row['state'], kind: string, raw: string | undefined): Row[] => {
    const file = storedQuizFile(raw)
    if (!file?.quiz) return []
    return [
      {
        key: `${record.id}:${state}`,
        record,
        state,
        kind,
        name: quizName(file.quiz),
        teams: (file.teams ?? []).map((t, i) => t.name.trim() || `Team ${i + 1}`).join(' · '),
        answers: file.answers?.length ?? 0,
        when: changedWhen(record.changedAt),
      },
    ]
  }
  if (record.newerRaw) return row('newer', 'From a newer version', record.newerRaw)
  const { current, saved, submitted } = record
  const shown = new Set([current?.file])
  const other = (state: 'saved' | 'submitted', kind: string, file: string | undefined) => {
    if (file === undefined || shown.has(file)) return []
    shown.add(file)
    return row(state, kind, file)
  }
  return [
    ...row('current', record.unsaved ? 'Unsaved' : '', current?.file),
    ...other('saved', 'As saved to a file', saved?.file),
    ...other(
      'submitted',
      `As submitted to ${submitted?.link?.meetName ?? 'the meet'}`,
      submitted?.file,
    ),
  ]
}

/** When a quiz last changed, as "today 14:02", "yesterday 09:15" or a date */
function changedWhen(at: number): string {
  const date = new Date(at)
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)
  if (days === 0) return `today ${time}`
  if (days === 1) return `yesterday ${time}`
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

async function restore(row: Row) {
  taken.value = ''
  if (row.state === 'newer') {
    if (await props.onOpenNewer(row.record)) close()
    return
  }
  const claim = await claimRecord(row.record.id)
  const record = claim?.record && readable(claim.record)
  if (!claim || !record?.current) {
    claim?.release()
    taken.value = 'That quiz was just opened in another tab.'
    records.value = records.value.filter((r) => r.id !== row.record.id)
    return
  }
  props.onRestore(record, claim, row.state)
  close()
}

async function discardAll() {
  const question =
    'Discard every recent quiz? Quizzes open in tabs are kept. This cannot be undone.'
  if (!(await confirmAction(question))) return
  await discardAllRecent()
  records.value = []
}

async function discard(row: Row) {
  if (!(await confirmAction(`Discard ${row.name}? All its states go, and this cannot be undone.`)))
    return
  taken.value = (await discardRecent(row.record.id))
    ? ''
    : 'That quiz was just opened in another tab.'
  records.value = records.value.filter((r) => r.id !== row.record.id)
}

function close() {
  dialogRef.value?.close()
}

function show(which: 'offer' | 'list', shown: QuizRecord[]) {
  form.value = which
  // A newer version's quiz, as such: listed with a warning, never shown as one of this version's
  records.value = shown.map(readable)
  taken.value = ''
  dialogRef.value?.showModal()
}

/** Offer a new tab the unsaved quizzes closed tabs left */
function offer(left: QuizRecord[]) {
  show('offer', left)
}

/** List every recent quiz */
async function list() {
  show('list', await listRecent())
}

defineExpose({ offer, list })
</script>

<template>
  <dialog ref="dialogRef" class="recent-quizzes" @click.self="close">
    <div class="recent-quizzes__inner">
      <div class="recent-quizzes__header">
        <span class="recent-quizzes__title">
          {{ form === 'offer' ? 'Unsaved quizzes from closed tabs' : 'Recent quizzes' }}
        </span>
        <button class="recent-quizzes__close" aria-label="Close" @click="close">×</button>
      </div>

      <p v-if="taken" class="recent-quizzes__state recent-quizzes__state--error">{{ taken }}</p>
      <p v-if="rows.length === 0" class="recent-quizzes__state">
        {{ form === 'offer' ? 'Nothing left to restore.' : 'No recent quizzes.' }}
      </p>
      <ul v-else class="recent-quizzes__list">
        <li v-for="row in rows" :key="row.key" class="recent-quizzes__row">
          <div class="recent-quizzes__what">
            <span class="recent-quizzes__name">{{ row.name }}</span>
            <span
              v-if="row.kind"
              :class="
                row.kind === 'Unsaved' ? 'recent-quizzes__kind--unsaved' : 'recent-quizzes__kind'
              "
              >{{ row.kind }}</span
            >
            <span class="recent-quizzes__teams">{{ row.teams }}</span>
            <span class="recent-quizzes__when">
              {{ row.answers }} {{ row.answers === 1 ? 'answer' : 'answers' }} · {{ row.when }}
            </span>
          </div>
          <button class="recent-quizzes__action" @click="restore(row)">Restore</button>
          <button class="recent-quizzes__action" @click="discard(row)">Discard</button>
        </li>
      </ul>

      <div class="recent-quizzes__footer">
        <button v-if="form === 'offer'" class="recent-quizzes__action" @click="close">
          Start a blank quiz
        </button>
        <template v-else>
          <button v-if="rows.length > 0" class="recent-quizzes__action" @click="discardAll">
            Discard all
          </button>
          <button class="recent-quizzes__action" @click="close">Close</button>
        </template>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.recent-quizzes {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 0;
  width: min(36rem, 95vw);
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  inset: 0;
  margin: auto;
}

.recent-quizzes::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.recent-quizzes__inner {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 90vh;
  overflow-y: auto;
}

.recent-quizzes__header,
.recent-quizzes__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.recent-quizzes__footer {
  justify-content: flex-end;
  gap: 4px;
}

.recent-quizzes__title {
  font-weight: 700;
  font-size: 0.9rem;
}

.recent-quizzes__close {
  background: none;
  border: none;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
}

.recent-quizzes__state {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  text-align: center;
  padding: 1.5rem 0;
}

.recent-quizzes__state--error {
  color: var(--color-invalid);
  padding: 0;
}

.recent-quizzes__list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
}

.recent-quizzes__row {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.4rem 0.5rem 0.4rem 0.75rem;
  font-size: 0.8rem;
}

.recent-quizzes__what {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 0.5rem;
}

.recent-quizzes__name {
  font-weight: 600;
}

.recent-quizzes__kind {
  font-size: 0.7rem;
  color: var(--color-text-faint);
}

.recent-quizzes__kind--unsaved {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-invalid);
}

.recent-quizzes__teams {
  flex-basis: 100%;
}

.recent-quizzes__when {
  font-size: 0.7rem;
  color: var(--color-text-faint);
}

.recent-quizzes__action {
  background: none;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
  font-family: inherit;
  color: var(--color-text);
  cursor: pointer;
}

.recent-quizzes__action:hover {
  background: var(--color-border-alt);
  border-color: var(--color-accent);
}
</style>
