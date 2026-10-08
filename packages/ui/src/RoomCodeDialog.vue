<script setup lang="ts">
import { ref, shallowRef } from 'vue'

/** A row of the dialog: one guest room, named for the user */
interface RoomCodeRow {
  key: string | number
  label: string
}

interface Request {
  title: string
  detail: string
  rows: RoomCodeRow[]
  /** Check a code entered for a row: null accepts it, a message refuses it and is shown on the row */
  onCode: (row: RoomCodeRow, code: string) => Promise<string | null>
  submitLabel: string
  closeLabel: string
  /** Whether each row can be skipped */
  skip: boolean
}

interface RowState {
  code: string
  message: string
  busy: boolean
  state: 'open' | 'accepted' | 'skipped'
}

const dialogRef = ref<HTMLDialogElement | null>(null)
const request = shallowRef<Request | null>(null)
const states = ref<RowState[]>([])
let settle: ((allAccepted: boolean) => void) | null = null

/**
 * Ask for a room code on each row: a renewal asks for one, the sign-in upgrade for one per room.
 * Resolves when every row is handled or the dialog is closed: true when every row was accepted.
 */
function ask(req: Request): Promise<boolean> {
  // A request made over an unanswered one closes it, so no caller waits forever
  settle?.(false)
  request.value = req
  states.value = req.rows.map(() => ({ code: '', message: '', busy: false, state: 'open' }))
  dialogRef.value?.showModal()
  return new Promise((resolve) => (settle = resolve))
}

function finish() {
  dialogRef.value?.close()
  settle?.(states.value.every((s) => s.state === 'accepted'))
  settle = null
}

function finishIfHandled() {
  if (states.value.every((s) => s.state !== 'open')) finish()
}

async function submit(index: number) {
  const req = request.value
  const row = states.value[index]
  if (!req || !row || row.busy) return
  const code = row.code.trim()
  if (!code) return
  row.busy = true
  row.message = ''
  try {
    const refusal = await req.onCode(req.rows[index]!, code)
    if (refusal === null) row.state = 'accepted'
    else row.message = refusal
  } finally {
    row.busy = false
  }
  finishIfHandled()
}

function skipRow(index: number) {
  const row = states.value[index]
  if (!row) return
  row.state = 'skipped'
  finishIfHandled()
}

defineExpose({ ask })
</script>

<template>
  <dialog ref="dialogRef" class="room-code-dialog" @cancel.prevent="finish">
    <div v-if="request" class="room-code-dialog__inner">
      <p class="room-code-dialog__title">{{ request.title }}</p>
      <p class="room-code-dialog__detail">{{ request.detail }}</p>
      <form
        v-for="(row, index) in request.rows"
        :key="row.key"
        class="room-code-dialog__row"
        @submit.prevent="submit(index)"
      >
        <span class="room-code-dialog__label">{{ row.label }}</span>
        <template v-if="states[index]?.state === 'open'">
          <div class="room-code-dialog__entry">
            <input
              v-model="states[index]!.code"
              class="room-code-dialog__input"
              placeholder="Room code"
              autocomplete="off"
              :disabled="states[index]!.busy"
            />
            <button
              type="submit"
              class="room-code-dialog__btn room-code-dialog__btn--primary"
              :disabled="states[index]!.busy || !states[index]!.code.trim()"
            >
              {{ request.submitLabel }}
            </button>
            <button
              v-if="request.skip"
              type="button"
              class="room-code-dialog__btn"
              @click="skipRow(index)"
            >
              Skip
            </button>
          </div>
          <p v-if="states[index]!.message" class="room-code-dialog__message">
            {{ states[index]!.message }}
          </p>
        </template>
        <span v-else class="room-code-dialog__done">
          {{ states[index]?.state === 'accepted' ? 'Added' : 'Skipped' }}
        </span>
      </form>
      <div class="room-code-dialog__actions">
        <button type="button" class="room-code-dialog__btn" @click="finish">
          {{ request.closeLabel }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.room-code-dialog {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 0;
  width: min(28rem, 92vw);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  inset: 0;
  margin: auto;
}

.room-code-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.room-code-dialog__inner {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.room-code-dialog__title {
  margin: 0;
  font-weight: 600;
}

.room-code-dialog__detail {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.room-code-dialog__row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.room-code-dialog__label {
  font-size: 0.9rem;
  font-weight: 500;
}

.room-code-dialog__entry {
  display: flex;
  gap: 0.4rem;
}

.room-code-dialog__input {
  flex: 1;
  min-width: 0;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}

.room-code-dialog__message {
  margin: 0;
  color: var(--color-error);
  font-size: 0.85rem;
}

.room-code-dialog__done {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.room-code-dialog__actions {
  display: flex;
  justify-content: flex-end;
}

.room-code-dialog__btn {
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}

.room-code-dialog__btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

.room-code-dialog__btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
