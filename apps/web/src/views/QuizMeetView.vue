<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getMeet, getMyMeets, updateMeet, type MeetDetail, type MeetMembership } from '../api'

const props = defineProps<{ id: number }>()
const router = useRouter()

const detail = ref<MeetDetail | null>(null)
const membership = ref<MeetMembership | null>(null)
const loading = ref(true)
const error = ref('')

const role = computed(() => membership.value?.role ?? null)
const isAdmin = computed(() => role.value === 'admin')
const isCoach = computed(() => role.value === 'head_coach' || role.value === 'admin')

// Inline editing
const editing = ref(false)
const editForm = ref({
  name: '',
  dateFrom: '',
  dateTo: '',
  viewerCode: '',
  divisions: [] as string[],
})
const newDivision = ref('')
const saving = ref(false)
const saveError = ref('')

async function load() {
  try {
    const [detailRes, myMeetsRes] = await Promise.all([getMeet(props.id), getMyMeets()])
    detail.value = detailRes
    membership.value = myMeetsRes.memberships.find((m) => m.meetId === props.id) ?? null
    if (!membership.value) {
      router.replace({ name: 'home' })
      return
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function startEdit() {
  const m = detail.value?.meet
  if (!m) return
  editForm.value = {
    name: m.name,
    dateFrom: m.dateFrom,
    dateTo: m.dateTo ?? '',
    viewerCode: m.viewerCode,
    divisions: [...m.divisions],
  }
  newDivision.value = ''
  editing.value = true
}

function addDivision() {
  const d = newDivision.value.trim()
  if (!d || editForm.value.divisions.includes(d)) return
  editForm.value.divisions.push(d)
  newDivision.value = ''
}

function removeDivision(i: number) {
  editForm.value.divisions.splice(i, 1)
}

async function saveEdit() {
  if (!detail.value) return
  saveError.value = ''
  saving.value = true
  try {
    const res = await updateMeet(detail.value.meet.id, { ...editForm.value })
    detail.value = { ...detail.value, meet: res.meet }
    editing.value = false
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'home' })">← QuizMeets</button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="detail">
      <!-- Meet info -->
      <div class="page-header">
        <template v-if="!editing">
          <div class="meet-info">
            <div class="meet-title-row">
              <h2 class="page-title">{{ detail.meet.name }}</h2>
              <span class="meet-meta"
                >{{ detail.meet.dateFrom
                }}{{
                  detail.meet.dateTo && detail.meet.dateTo !== detail.meet.dateFrom
                    ? ` – ${detail.meet.dateTo}`
                    : ''
                }}</span
              >
            </div>
            <div v-if="detail.meet.divisions.length" class="division-tags">
              <span class="division-tags-label">Divisions</span>
              <span v-for="d in detail.meet.divisions" :key="d" class="division-tag">{{ d }}</span>
            </div>
          </div>
          <button v-if="isAdmin" class="icon-btn" title="Edit meet" @click="startEdit">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </template>
        <form v-else class="edit-form" @submit.prevent="saveEdit">
          <div class="edit-fields">
            <input v-model="editForm.name" class="field-input" placeholder="Name" required />
            <input v-model="editForm.dateFrom" class="field-input" type="date" required />
            <input v-model="editForm.dateTo" class="field-input" type="date" />
            <input
              v-model="editForm.viewerCode"
              class="field-input"
              placeholder="Viewer code"
              required
            />
          </div>
          <div class="divisions-edit">
            <div class="division-tags">
              <span
                v-for="(d, i) in editForm.divisions"
                :key="d"
                class="division-tag division-tag--removable"
              >
                {{ d }}
                <button type="button" class="division-remove" @click="removeDivision(i)">
                  &times;
                </button>
              </span>
            </div>
            <div class="division-add">
              <input
                v-model="newDivision"
                class="field-input"
                placeholder="Add division"
                @keydown.enter.prevent="addDivision"
              />
              <button type="button" class="btn btn--secondary" @click="addDivision">Add</button>
            </div>
          </div>
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
      </div>

      <!-- Codes -->
      <div class="section">
        <div class="section-header">
          <h3 class="section-title">Codes</h3>
          <button
            v-if="isAdmin"
            class="manage-link"
            @click="router.push({ name: 'meet-admin', params: { id } })"
          >
            Manage codes
          </button>
        </div>
        <div class="code-row">
          <span class="code-label">Viewer</span>
          <code class="code-value">{{ detail.meet.viewerCode }}</code>
        </div>
      </div>

      <!-- Actions -->
      <div class="card-grid">
        <button
          v-if="isCoach"
          class="card"
          @click="router.push({ name: 'meet-teams', params: { id } })"
        >
          <span class="card-title">Teams &amp; Rosters</span>
          <span class="card-desc">Manage churches, teams, and quizzers</span>
        </button>
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
  flex-direction: column;
  gap: 0.4rem;
  flex: 1;
}

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.meet-meta {
  font-size: 0.8rem;
  color: var(--color-text-faint);
}

.icon-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-faint);
  border-radius: 4px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.icon-btn:hover {
  color: var(--color-text-muted);
  background: var(--color-bg-raised);
}

/* Edit form */
.edit-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.edit-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
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

.field-input--wide {
  flex: 1;
  min-width: 14rem;
}

.field-input:focus {
  border-color: var(--color-accent);
}

.field-error {
  font-size: 0.8rem;
  color: var(--palette-error);
}

.edit-actions {
  display: flex;
  gap: 0.5rem;
}

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

/* Codes section */
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
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
}

.manage-link {
  background: none;
  border: none;
  font-size: 0.8rem;
  color: var(--color-accent);
  cursor: pointer;
  font-family: inherit;
  padding: 0;
}

.manage-link:hover {
  text-decoration: underline;
}

.code-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.code-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-muted);
  min-width: 5rem;
}

.code-value {
  font-family: monospace;
  font-size: 0.875rem;
  color: var(--color-text);
}

/* Cards */
.card-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  min-width: 14rem;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color 0.15s;
}

.card:hover {
  border-color: var(--color-accent);
}

.card-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-heading);
}

.card-desc {
  font-size: 0.8rem;
  color: var(--color-text-faint);
}

.meet-title-row {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.division-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.division-tags-label {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  margin-right: 0.15rem;
}

.division-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  padding: 0.2rem 0.55rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 99px;
  color: var(--color-text-muted);
}

.division-tag--removable {
  padding-right: 0.35rem;
}

.division-remove {
  background: none;
  border: none;
  padding: 0 0.1rem;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
  color: var(--color-text-faint);
  font-family: inherit;
}

.division-remove:hover {
  color: var(--palette-error);
}

.divisions-edit {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.division-add {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.division-add .field-input {
  max-width: 14rem;
}
</style>
