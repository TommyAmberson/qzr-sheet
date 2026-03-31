<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listMeets, createMeet, deleteMeet, type Meet } from '../api'

const router = useRouter()

const meets = ref<Meet[]>([])
const loading = ref(true)
const error = ref('')

const showCreate = ref(false)
const creating = ref(false)
const createError = ref('')
const form = ref({ name: '', dateFrom: '', dateTo: '', viewerCode: '' })
const newCoachCode = ref('')

async function load() {
  try {
    const res = await listMeets()
    meets.value = res.meets
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function submitCreate() {
  createError.value = ''
  creating.value = true
  try {
    const res = await createMeet(form.value)
    newCoachCode.value = res.coachCode
    meets.value.push(res.meet)
    form.value = { name: '', dateFrom: '', dateTo: '', viewerCode: '' }
  } catch (e) {
    createError.value = (e as Error).message
  } finally {
    creating.value = false
  }
}

function dismissCreate() {
  showCreate.value = false
  newCoachCode.value = ''
  createError.value = ''
}

async function handleDelete(meet: Meet) {
  if (!confirm(`Delete "${meet.name}"? This cannot be undone.`)) return
  try {
    await deleteMeet(meet.id)
    meets.value = meets.value.filter((m) => m.id !== meet.id)
  } catch (e) {
    alert((e as Error).message)
  }
}

onMounted(load)
</script>

<template>
  <div class="container">
    <div class="page-header">
      <h2 class="page-title">Meets</h2>
      <button class="btn btn--primary" @click="showCreate = true">New meet</button>
    </div>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>
    <p v-else-if="meets.length === 0" class="state-msg">No meets yet.</p>

    <ul v-else class="meet-list">
      <li v-for="meet in meets" :key="meet.id" class="meet-row">
        <button
          class="meet-name"
          @click="router.push({ name: 'admin-meet-detail', params: { id: meet.id } })"
        >
          {{ meet.name }}
        </button>
        <span class="meet-date"
          >{{ meet.dateFrom
          }}{{ meet.dateTo && meet.dateTo !== meet.dateFrom ? ` – ${meet.dateTo}` : '' }}</span
        >
        <button class="action-btn action-btn--danger" @click="handleDelete(meet)">Delete</button>
      </li>
    </ul>

    <!-- Create modal -->
    <div v-if="showCreate" class="modal-backdrop" @click.self="dismissCreate">
      <div class="modal">
        <h3 class="modal-title">New meet</h3>

        <template v-if="newCoachCode">
          <p class="coach-code-label">
            Meet created. Save the coach code — it won't be shown again.
          </p>
          <div class="code-box">{{ newCoachCode }}</div>
          <div class="modal-actions">
            <button class="btn btn--primary" @click="dismissCreate">Done</button>
          </div>
        </template>

        <form v-else @submit.prevent="submitCreate">
          <div class="field">
            <label class="field-label" for="meet-name">Name</label>
            <input id="meet-name" v-model="form.name" class="field-input" required />
          </div>
          <div class="field">
            <label class="field-label" for="meet-date-from">Start date</label>
            <input
              id="meet-date-from"
              v-model="form.dateFrom"
              class="field-input"
              type="date"
              required
            />
          </div>
          <div class="field">
            <label class="field-label" for="meet-date-to"
              >End date <span class="field-optional">(optional)</span></label
            >
            <input id="meet-date-to" v-model="form.dateTo" class="field-input" type="date" />
          </div>
          <div class="field">
            <label class="field-label" for="viewer-code">Viewer code</label>
            <input id="viewer-code" v-model="form.viewerCode" class="field-input" required />
          </div>
          <p v-if="createError" class="field-error">{{ createError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn--secondary" @click="dismissCreate">Cancel</button>
            <button type="submit" class="btn btn--primary" :disabled="creating">
              {{ creating ? 'Creating…' : 'Create' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.page-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
}

.state-msg--error {
  color: var(--palette-error);
}

.meet-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.meet-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
}

.meet-name {
  flex: 1;
  background: none;
  border: none;
  padding: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-accent);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.meet-name:hover {
  color: var(--color-accent-hover);
}

.meet-date {
  font-size: 0.8rem;
  color: var(--color-text-faint);
}

.action-btn {
  background: none;
  border: none;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.action-btn--danger {
  color: var(--palette-error);
}

.action-btn--danger:hover {
  background: var(--palette-error-alt);
}

/* Buttons (same as HomeView) */
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
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

.btn--primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.btn--secondary:hover {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.5rem;
  width: min(28rem, calc(100vw - 2rem));
}

.modal-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 1.25rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 1rem;
}

.field-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.field-input {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.45rem 0.7rem;
  font-size: 0.875rem;
  color: var(--color-text);
  font-family: inherit;
  outline: none;
}

.field-input:focus {
  border-color: var(--color-accent);
}

.field-optional {
  font-weight: 400;
  color: var(--color-text-faint);
}

.field-error {
  font-size: 0.8rem;
  color: var(--palette-error);
  margin-bottom: 0.75rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1rem;
}

.coach-code-label {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin-bottom: 0.75rem;
}

.code-box {
  font-family: monospace;
  font-size: 0.95rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.6rem 0.9rem;
  word-break: break-all;
  margin-bottom: 1rem;
  color: var(--color-text);
}
</style>
