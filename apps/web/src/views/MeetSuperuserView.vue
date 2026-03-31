<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  getMeet,
  rotateCoachCode,
  createOfficialCode,
  deleteOfficialCode,
  rotateOfficialCode,
  type OfficialCode,
} from '../api'

const props = defineProps<{ id: number }>()
const router = useRouter()

const meetName = ref('')
const officialCodes = ref<OfficialCode[]>([])
const loading = ref(true)
const error = ref('')

const revealedCodes = ref<Record<string, string>>({})
const coachCodeBusy = ref(false)
const officialCodeBusy = ref<Record<number, boolean>>({})

const newOfficialLabel = ref('')
const addingOfficial = ref(false)
const addOfficialError = ref('')

async function load() {
  try {
    const res = await getMeet(props.id)
    meetName.value = res.meet.name
    officialCodes.value = res.officialCodes
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function handleRotateCoachCode() {
  if (!confirm('Rotate the coach code? The old code will stop working immediately.')) return
  coachCodeBusy.value = true
  try {
    const res = await rotateCoachCode(props.id)
    revealedCodes.value['coach'] = res.coachCode
  } catch (e) {
    alert((e as Error).message)
  } finally {
    coachCodeBusy.value = false
  }
}

async function handleAddOfficial() {
  addOfficialError.value = ''
  addingOfficial.value = true
  try {
    const res = await createOfficialCode(props.id, newOfficialLabel.value)
    officialCodes.value.push(res.officialCode)
    revealedCodes.value[`official-${res.officialCode.id}`] = res.code
    newOfficialLabel.value = ''
  } catch (e) {
    addOfficialError.value = (e as Error).message
  } finally {
    addingOfficial.value = false
  }
}

async function handleRotateOfficial(codeId: number) {
  if (!confirm('Rotate this code? The old code will stop working immediately.')) return
  officialCodeBusy.value[codeId] = true
  try {
    const res = await rotateOfficialCode(props.id, codeId)
    revealedCodes.value[`official-${res.officialCode.id}`] = res.code
  } catch (e) {
    alert((e as Error).message)
  } finally {
    delete officialCodeBusy.value[codeId]
  }
}

async function handleDeleteOfficial(codeId: number) {
  if (!confirm('Delete this official code?')) return
  try {
    await deleteOfficialCode(props.id, codeId)
    officialCodes.value = officialCodes.value.filter((c) => c.id !== codeId)
    delete revealedCodes.value[`official-${codeId}`]
  } catch (e) {
    alert((e as Error).message)
  }
}

onMounted(load)
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'meet', params: { id } })">
      ← {{ meetName || 'QuizMeet' }}
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else>
      <h2 class="page-title">Codes</h2>

      <!-- Coach code -->
      <div class="section">
        <h3 class="section-title">Coach</h3>
        <div class="code-row">
          <template v-if="revealedCodes['coach']">
            <code class="code-value code-value--revealed">{{ revealedCodes['coach'] }}</code>
          </template>
          <span v-else class="code-value code-value--hidden">••••••••</span>
          <button class="action-btn" :disabled="coachCodeBusy" @click="handleRotateCoachCode">
            {{ coachCodeBusy ? '…' : 'Rotate' }}
          </button>
        </div>
      </div>

      <!-- Official codes -->
      <div class="section">
        <h3 class="section-title">Official codes</h3>

        <p v-if="officialCodes.length === 0" class="state-msg">No official codes yet.</p>
        <ul v-else class="code-list">
          <li v-for="oc in officialCodes" :key="oc.id" class="code-row">
            <span class="code-label">{{ oc.label }}</span>
            <template v-if="revealedCodes[`official-${oc.id}`]">
              <code class="code-value code-value--revealed">{{
                revealedCodes[`official-${oc.id}`]
              }}</code>
            </template>
            <span v-else class="code-value code-value--hidden">••••••••</span>
            <button
              class="action-btn"
              :disabled="officialCodeBusy[oc.id]"
              @click="handleRotateOfficial(oc.id)"
            >
              {{ officialCodeBusy[oc.id] ? '…' : 'Rotate' }}
            </button>
            <button class="action-btn action-btn--danger" @click="handleDeleteOfficial(oc.id)">
              Delete
            </button>
          </li>
        </ul>

        <form class="add-form" @submit.prevent="handleAddOfficial">
          <input
            v-model="newOfficialLabel"
            class="field-input"
            placeholder="Label (e.g. Room 1)"
            required
          />
          <button type="submit" class="btn btn--secondary" :disabled="addingOfficial">
            {{ addingOfficial ? 'Adding…' : 'Add code' }}
          </button>
          <p v-if="addOfficialError" class="field-error">{{ addOfficialError }}</p>
        </form>
      </div>
    </template>
  </div>
</template>

<style scoped>
.container {
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.back-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.8rem;
  color: var(--color-text-faint);
  cursor: pointer;
  font-family: inherit;
  margin-bottom: 1.5rem;
  display: inline-block;
}

.back-link:hover {
  color: var(--color-text-muted);
}

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
}

.state-msg--error {
  color: var(--palette-error);
}

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 1.5rem;
}

.section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-bottom: 0.75rem;
}

.code-list {
  list-style: none;
}

.code-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--color-border-alt);
}

.code-row:last-child {
  border-bottom: none;
}

.code-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-muted);
  min-width: 6rem;
}

.code-value {
  font-family: monospace;
  font-size: 0.875rem;
  flex: 1;
}

.code-value--revealed {
  color: var(--color-text);
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  word-break: break-all;
}

.code-value--hidden {
  color: var(--color-text-faint);
  letter-spacing: 0.1em;
}

.action-btn {
  background: none;
  border: none;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
  padding: 0.2rem 0.45rem;
  border-radius: 4px;
  color: var(--color-text-faint);
}

.action-btn:hover:not(:disabled) {
  color: var(--color-text-muted);
  background: var(--color-bg-raised);
}

.action-btn--danger {
  color: var(--palette-error);
}

.action-btn--danger:hover:not(:disabled) {
  background: var(--palette-error-alt);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.add-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.875rem;
}

.field-input {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.4rem 0.65rem;
  font-size: 0.875rem;
  color: var(--color-text);
  font-family: inherit;
  outline: none;
  min-width: 0;
}

.field-input:focus {
  border-color: var(--color-accent);
}

.field-error {
  font-size: 0.8rem;
  color: var(--palette-error);
  width: 100%;
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.85rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.btn--secondary:hover:not(:disabled) {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
