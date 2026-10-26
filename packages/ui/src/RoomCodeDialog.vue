<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import type { RoomCodeOffer, RoomCodeRequest, RoomCodeRow } from './guestSession'

interface Entry {
  row: RoomCodeRow
  code: string
  message: string
  /** An offer to carry on somewhere else, shown until it's taken or another code is entered */
  offer: RoomCodeOffer | null
  busy: boolean
  state: 'open' | 'accepted' | 'skipped'
}

const dialogRef = ref<HTMLDialogElement | null>(null)
const request = shallowRef<RoomCodeRequest | null>(null)
const entries = ref<Entry[]>([])
let settle: ((allAccepted: boolean) => void) | null = null

/**
 * Ask for a room code on each row: a renewal asks for one, the sign-in upgrade for one per room.
 * Resolves when every row is handled or the dialog is closed: true when every row was accepted.
 */
function ask(req: RoomCodeRequest): Promise<boolean> {
  // A request made over an unanswered one closes it, so no caller waits forever
  settle?.(false)
  request.value = req
  entries.value = req.rows.map((row) => ({
    row,
    code: '',
    message: '',
    offer: null,
    busy: false,
    state: 'open',
  }))
  dialogRef.value?.showModal()
  return new Promise((resolve) => (settle = resolve))
}

function finish() {
  dialogRef.value?.close()
  settle?.(entries.value.every((e) => e.state === 'accepted'))
  settle = null
}

function finishIfHandled() {
  if (entries.value.every((e) => e.state !== 'open')) finish()
}

async function submit(entry: Entry) {
  const code = entry.code.trim()
  if (!request.value || entry.busy || !code) return
  entry.busy = true
  entry.message = ''
  try {
    const answer = await request.value.onCode(entry.row, code)
    if (answer === null) entry.state = 'accepted'
    else if (typeof answer === 'string') entry.message = answer
    else entry.offer = answer
  } finally {
    entry.busy = false
  }
  finishIfHandled()
}

function takeOffer(entry: Entry) {
  entry.offer?.take()
  entry.state = 'accepted'
  finishIfHandled()
}

function skip(entry: Entry) {
  entry.state = 'skipped'
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
        v-for="entry in entries"
        :key="entry.row.meetId"
        class="room-code-dialog__row"
        @submit.prevent="submit(entry)"
      >
        <span class="room-code-dialog__label">{{ entry.row.label }}</span>
        <template v-if="entry.state === 'open' && entry.offer">
          <p class="room-code-dialog__offer">{{ entry.offer.message }}</p>
          <div class="room-code-dialog__entry">
            <button
              type="button"
              class="room-code-dialog__btn room-code-dialog__btn--primary"
              @click="takeOffer(entry)"
            >
              {{ entry.offer.accept }}
            </button>
            <button type="button" class="room-code-dialog__btn" @click="entry.offer = null">
              Enter another code
            </button>
          </div>
        </template>
        <template v-else-if="entry.state === 'open'">
          <div class="room-code-dialog__entry">
            <input
              v-model="entry.code"
              class="room-code-dialog__input"
              placeholder="Room code"
              autocomplete="off"
              :disabled="entry.busy"
            />
            <button
              type="submit"
              class="room-code-dialog__btn room-code-dialog__btn--primary"
              :disabled="entry.busy || !entry.code.trim()"
            >
              {{ request.submitLabel }}
            </button>
            <button
              v-if="request.skip"
              type="button"
              class="room-code-dialog__btn"
              @click="skip(entry)"
            >
              Skip
            </button>
          </div>
          <p v-if="entry.message" class="room-code-dialog__message">{{ entry.message }}</p>
        </template>
        <span v-else class="room-code-dialog__done">
          {{ entry.state === 'accepted' ? 'Added' : 'Skipped' }}
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

.room-code-dialog__offer {
  margin: 0;
  font-size: 0.9rem;
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
