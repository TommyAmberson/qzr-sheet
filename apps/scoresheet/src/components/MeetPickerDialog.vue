<script setup lang="ts">
import { computed, ref } from 'vue'

import { type MeetSummary } from '../api'
import { useMeetList } from '../composables/useMeetList'
import { useMeetSession } from '../composables/useMeetSession'
import { maySend } from '../composables/useSubmitToMeet'

const emit = defineEmits<{ loaded: [] }>()

const { loadMeet } = useMeetSession()
const {
  meets,
  loading,
  error,
  joinCode,
  joinError,
  joining,
  signedIn,
  init,
  handleJoinCode,
  setActiveGuest,
} = useMeetList()

const dialogRef = ref<HTMLDialogElement | null>(null)
const submitting = ref(false)
/** Loading a meet's teams links the sheet to it; choosing where to submit leaves the sheet as it is */
const purpose = ref<'load' | 'submit'>('load')
/** When submitting, the meet last submitted to, marked in the list */
const lastMeetId = ref<number | null>(null)
let settle: ((meet: MeetSummary | null) => void) | null = null

/** The meets to offer: all of the user's for loading teams, only those they may send to otherwise */
const listed = computed(() =>
  purpose.value === 'submit' ? meets.value.filter((meet) => maySend(meet.role)) : meets.value,
)

async function selectMeet(meet: MeetSummary) {
  if (purpose.value === 'submit') {
    const chosen = settle
    settle = null
    dialogRef.value?.close()
    chosen?.(meet)
    return
  }
  submitting.value = true
  error.value = ''
  try {
    setActiveGuest(meet.meetId)
    await loadMeet(meet.meetId, meet.meetName)
    dialogRef.value?.close()
    emit('loaded')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    submitting.value = false
  }
}

function close() {
  dialogRef.value?.close()
}

/** However the dialog closes without a choice, a pending submit gets none */
function onClosed() {
  settle?.(null)
  settle = null
}

/** Load a meet's teams into the sheet, linking it to the meet */
async function open() {
  purpose.value = 'load'
  dialogRef.value?.showModal()
  await init()
}

/**
 * Choose a meet to submit to, from those the user may send to, joining one with a code if need be.
 * Resolves to the meet, or null when the dialog is closed; the sheet isn't linked either way.
 */
async function chooseForSubmit(last: number | null): Promise<MeetSummary | null> {
  onClosed()
  purpose.value = 'submit'
  lastMeetId.value = last
  const chosen = new Promise<MeetSummary | null>((resolve) => (settle = resolve))
  dialogRef.value?.showModal()
  await init()
  return chosen
}

defineExpose({ open, chooseForSubmit })
</script>

<template>
  <dialog ref="dialogRef" class="meet-picker-dialog" @click.self="close" @close="onClosed">
    <div class="meet-picker-inner">
      <div class="meet-picker-header">
        <span class="meet-picker-title">{{
          purpose === 'submit' ? 'Submit to which meet?' : 'Load teams from meet'
        }}</span>
        <button class="meet-picker-close" @click="close">×</button>
      </div>

      <p v-if="loading" class="meet-picker-state">Loading…</p>
      <p
        v-else-if="purpose === 'submit' && listed.length === 0 && (!error || signedIn === false)"
        class="meet-picker-state"
      >
        {{
          signedIn
            ? "You aren't an admin or official of a meet yet. Join one with your room code."
            : 'Sign in, or join a meet with your room code.'
        }}
      </p>
      <p v-else-if="error" class="meet-picker-state meet-picker-state--error">{{ error }}</p>
      <p v-else-if="listed.length === 0" class="meet-picker-state">No meets found.</p>

      <ul v-else class="meet-list">
        <li v-for="meet in listed" :key="meet.meetId">
          <button
            class="meet-row"
            :class="{ 'meet-row--last': purpose === 'submit' && meet.meetId === lastMeetId }"
            :disabled="submitting"
            @click="selectMeet(meet)"
          >
            <span class="meet-row-name">{{ meet.meetName }}</span>
            <span class="meet-row-role">{{
              purpose === 'submit' && meet.meetId === lastMeetId ? 'last used' : meet.role
            }}</span>
          </button>
        </li>
      </ul>

      <hr class="meet-picker-divider" />

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
    </div>
  </dialog>
</template>

<style scoped>
.meet-picker-dialog {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 0;
  width: min(24rem, 90vw);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  /* Center via inset:0 + margin:auto. The earlier top:50% / left:50% /
     transform combo collided with the UA :modal stylesheet (which sets
     inset:0) and produced off-centre placement on Firefox/desktop. */
  inset: 0;
  margin: auto;
}

.meet-picker-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.meet-picker-inner {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.meet-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.meet-picker-title {
  font-weight: 700;
  font-size: 0.9rem;
}

.meet-picker-close {
  background: none;
  border: none;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
}

.meet-picker-close:hover {
  color: var(--color-text);
  background: var(--color-border-alt);
}

.meet-picker-state {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  text-align: center;
  padding: 0.75rem 0;
}

.meet-picker-state--error {
  color: var(--color-invalid);
}

.meet-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
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

.meet-row--last {
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

.meet-picker-divider {
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
</style>
