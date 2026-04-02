<script setup lang="ts">
import { ref } from 'vue'
import { getMyMeets, ApiError, type MeetSummary } from '../api'
import { useMeetSession } from '../composables/useMeetSession'

const emit = defineEmits<{ loaded: [] }>()

const { loadMeet } = useMeetSession()

const dialogRef = ref<HTMLDialogElement | null>(null)
const meets = ref<MeetSummary[]>([])
const loading = ref(false)
const error = ref('')
const submitting = ref(false)

async function fetchMeets() {
  loading.value = true
  error.value = ''
  try {
    const res = await getMyMeets()
    // Deduplicate by meetId (a user can have multiple roles in one meet)
    const seen = new Set<number>()
    meets.value = res.memberships.filter((m) => {
      if (seen.has(m.meetId)) return false
      seen.add(m.meetId)
      return true
    })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      error.value = 'Not signed in.'
    } else {
      error.value = (e as Error).message
    }
  } finally {
    loading.value = false
  }
}

async function selectMeet(meet: MeetSummary) {
  submitting.value = true
  error.value = ''
  try {
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

function open() {
  dialogRef.value?.showModal()
  fetchMeets()
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialogRef" class="meet-picker-dialog" @click.self="close">
    <div class="meet-picker-inner">
      <div class="meet-picker-header">
        <span class="meet-picker-title">Load teams from meet</span>
        <button class="meet-picker-close" @click="close">×</button>
      </div>

      <p v-if="loading" class="meet-picker-state">Loading…</p>
      <p v-else-if="error" class="meet-picker-state meet-picker-state--error">{{ error }}</p>
      <p v-else-if="meets.length === 0" class="meet-picker-state">No meets found.</p>

      <ul v-else class="meet-list">
        <li v-for="meet in meets" :key="meet.meetId">
          <button class="meet-row" :disabled="submitting" @click="selectMeet(meet)">
            <span class="meet-row-name">{{ meet.meetName }}</span>
            <span class="meet-row-role">{{ meet.role }}</span>
          </button>
        </li>
      </ul>
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
</style>
