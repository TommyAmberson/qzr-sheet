<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  getMeet,
  updateMeet,
  rotateCoachCode,
  createOfficialCode,
  deleteOfficialCode,
  rotateOfficialCode,
  type QuizMeet,
  type OfficialCode,
} from '../api'

const props = defineProps<{ id: number }>()
const router = useRouter()

const meet = ref<QuizMeet | null>(null)
const officialCodes = ref<OfficialCode[]>([])
const loading = ref(true)
const error = ref('')

// Editing meet fields
const editing = ref(false)
const editForm = ref({ name: '', dateFrom: '', dateTo: '', viewerCode: '', divisionsRaw: '' })
const saving = ref(false)
const saveError = ref('')

// Codes being revealed (id → plaintext)
const revealedCodes = ref<Record<string, string>>({})
const coachCodeBusy = ref(false)
const officialCodeBusy = ref<Record<number, boolean>>({})

// New official code form
const newOfficialLabel = ref('')
const addingOfficial = ref(false)
const addOfficialError = ref('')

async function load() {
  try {
    const res = await getMeet(props.id)
    meet.value = res.meet
    officialCodes.value = res.officialCodes
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function startEdit() {
  if (!meet.value) return
  editForm.value = {
    name: meet.value.name,
    dateFrom: meet.value.dateFrom,
    dateTo: meet.value.dateTo ?? '',
    viewerCode: meet.value.viewerCode,
    divisionsRaw: meet.value.divisions.join(', '),
  }
  editing.value = true
}

async function saveEdit() {
  if (!meet.value) return
  saveError.value = ''
  saving.value = true
  try {
    const divisions = editForm.value.divisionsRaw
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
    const res = await updateMeet(meet.value.id, { ...editForm.value, divisions })
    meet.value = res.meet
    editing.value = false
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function handleRotateCoachCode() {
  if (!meet.value) return
  if (!confirm('Rotate the coach code? The old code will stop working immediately.')) return
  coachCodeBusy.value = true
  try {
    const res = await rotateCoachCode(meet.value.id)
    revealedCodes.value['coach'] = res.coachCode
  } catch (e) {
    alert((e as Error).message)
  } finally {
    coachCodeBusy.value = false
  }
}

async function handleAddOfficial() {
  if (!meet.value) return
  addOfficialError.value = ''
  addingOfficial.value = true
  try {
    const res = await createOfficialCode(meet.value.id, newOfficialLabel.value)
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
  if (!meet.value) return
  if (!confirm('Rotate this code? The old code will stop working immediately.')) return
  officialCodeBusy.value[codeId] = true
  try {
    const res = await rotateOfficialCode(meet.value.id, codeId)
    revealedCodes.value[`official-${res.officialCode.id}`] = res.code
  } catch (e) {
    alert((e as Error).message)
  } finally {
    delete officialCodeBusy.value[codeId]
  }
}

async function handleDeleteOfficial(codeId: number) {
  if (!meet.value) return
  if (!confirm('Delete this official code?')) return
  try {
    await deleteOfficialCode(meet.value.id, codeId)
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
    <button class="back-link" @click="router.push({ name: 'admin-meets' })">← Meets</button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet">
      <!-- Meet header -->
      <div class="page-header">
        <div v-if="!editing" class="meet-info">
          <h2 class="page-title">{{ meet.name }}</h2>
          <span class="meet-date">
            {{ meet.dateFrom
            }}{{ meet.dateTo && meet.dateTo !== meet.dateFrom ? ` – ${meet.dateTo}` : '' }}
          </span>
          <span class="meet-divisions">{{ meet.divisions.join(', ') }}</span>
        </div>
        <form v-else class="edit-form" @submit.prevent="saveEdit">
          <input v-model="editForm.name" class="field-input" placeholder="Name" required />
          <input v-model="editForm.dateFrom" class="field-input" type="date" required />
          <input
            v-model="editForm.dateTo"
            class="field-input"
            type="date"
            placeholder="End date (optional)"
          />
          <input
            v-model="editForm.viewerCode"
            class="field-input"
            placeholder="Viewer code"
            required
          />
          <input
            v-model="editForm.divisionsRaw"
            class="field-input"
            placeholder="Divisions (e.g. Div 1, Div 2, Div 3)"
            required
          />
          <p v-if="saveError" class="field-error">{{ saveError }}</p>
          <div class="edit-actions">
            <button type="button" class="btn btn--secondary" @click="editing = false">
              Cancel
            </button>
            <button type="submit" class="btn btn--primary" :disabled="saving">
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </form>
        <button v-if="!editing" class="btn btn--secondary" @click="startEdit">Edit</button>
      </div>

      <!-- Codes section -->
      <div class="section">
        <h3 class="section-title">Codes</h3>

        <!-- Viewer code -->
        <div class="code-row">
          <span class="code-label">Viewer</span>
          <code class="code-value">{{ meet.viewerCode }}</code>
          <span class="code-hint">(edit above to change)</span>
        </div>

        <!-- Coach code -->
        <div class="code-row">
          <span class="code-label">Coach</span>
          <template v-if="revealedCodes['coach']">
            <code class="code-value code-value--revealed">{{ revealedCodes['coach'] }}</code>
          </template>
          <template v-else>
            <span class="code-value code-value--hidden">••••••••</span>
          </template>
          <button class="action-btn" :disabled="coachCodeBusy" @click="handleRotateCoachCode">
            {{ coachCodeBusy ? '…' : 'Rotate' }}
          </button>
        </div>
      </div>

      <!-- Official codes section -->
      <div class="section">
        <div class="section-header">
          <h3 class="section-title">Official codes</h3>
        </div>

        <p v-if="officialCodes.length === 0" class="state-msg">No official codes yet.</p>
        <ul v-else class="code-list">
          <li v-for="oc in officialCodes" :key="oc.id" class="code-row">
            <span class="code-label">{{ oc.label }}</span>
            <template v-if="revealedCodes[`official-${oc.id}`]">
              <code class="code-value code-value--revealed">{{
                revealedCodes[`official-${oc.id}`]
              }}</code>
            </template>
            <template v-else>
              <span class="code-value code-value--hidden">••••••••</span>
            </template>
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

        <!-- Add official code -->
        <form class="add-form" @submit.prevent="handleAddOfficial">
          <input
            v-model="newOfficialLabel"
            class="field-input add-input"
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

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 2rem;
}

.meet-info {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.meet-date {
  font-size: 0.8rem;
  color: var(--color-text-faint);
}

.meet-divisions {
  font-size: 0.8rem;
  color: var(--color-text-faint);
}

.edit-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex: 1;
}

.edit-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
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

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.85rem;
  border-radius: 6px;
  font-size: 0.8rem;
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

.btn--primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: var(--color-accent);
}

.btn--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
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

/* Sections */
.section {
  margin-bottom: 2rem;
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.75rem;
}

.code-list {
  list-style: none;
}

.code-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0;
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

.code-hint {
  font-size: 0.75rem;
  color: var(--color-text-faint);
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

/* Add official form */
.add-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
}

.add-input {
  flex: 1;
  min-width: 10rem;
}
</style>
