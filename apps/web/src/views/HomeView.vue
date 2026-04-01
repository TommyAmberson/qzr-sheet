<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { getMyMeets, joinMeet, joinMeetGuest, createMeet, type MeetMembership } from '../api'

const scoresheetUrl = __SCORESHEET_URL__
const router = useRouter()
const { session } = useAuth()

const memberships = ref<MeetMembership[]>([])
const loadingMeets = ref(false)
const meetsError = ref('')

const code = ref('')
const submitting = ref(false)
const codeError = ref('')

const isSuperuser = computed(
  () => (session.value?.data?.user as Record<string, unknown> | undefined)?.role === 'superuser',
)

const showCreateMeet = ref(false)
const meetForm = ref({ name: '', dateFrom: '', dateTo: '', viewerCode: '', divisions: [''] })
const creatingMeet = ref(false)
const createMeetError = ref('')

async function loadMeets() {
  if (!session.value?.data?.user) return
  loadingMeets.value = true
  try {
    const res = await getMyMeets()
    memberships.value = res.memberships
  } catch (e) {
    meetsError.value = (e as Error).message
  } finally {
    loadingMeets.value = false
  }
}

async function handleCode() {
  codeError.value = ''
  submitting.value = true
  try {
    const c = code.value.trim()
    // Signed-in: save to account. Guest: get a JWT and navigate.
    if (session.value?.data?.user) {
      const res = await joinMeet(c)
      code.value = ''
      // Refresh list so the new meet appears
      await loadMeets()
      const joined = memberships.value.find((m) => m.meetId === res.meet.id)
      router.push({ name: 'meet', params: { slug: joined?.viewerCode ?? res.meet.id } })
    } else {
      const res = await joinMeetGuest(c)
      code.value = ''
      // TODO: store the guest JWT (res.token) for API calls on the meet page
      router.push({ name: 'meet', params: { slug: res.meet.id } })
    }
  } catch (e) {
    codeError.value = (e as Error).message
  } finally {
    submitting.value = false
  }
}

async function handleCreateMeet() {
  createMeetError.value = ''
  creatingMeet.value = true
  try {
    const f = meetForm.value
    const divisions = f.divisions.map((d) => d.trim()).filter(Boolean)
    if (divisions.length === 0) {
      createMeetError.value = 'At least one division is required'
      return
    }
    const res = await createMeet({
      name: f.name.trim(),
      dateFrom: f.dateFrom,
      dateTo: f.dateTo || undefined,
      viewerCode: f.viewerCode.trim(),
      divisions,
    })
    showCreateMeet.value = false
    meetForm.value = { name: '', dateFrom: '', dateTo: '', viewerCode: '', divisions: [''] }
    alert(`Admin code: ${res.adminCode}\n\nSave this — it won't be shown again.`)
    await loadMeets()
    router.push({ name: 'meet', params: { slug: res.meet.viewerCode } })
  } catch (e) {
    createMeetError.value = (e as Error).message
  } finally {
    creatingMeet.value = false
  }
}

function addDivisionField() {
  meetForm.value.divisions.push('')
}

function removeDivisionField(i: number) {
  meetForm.value.divisions.splice(i, 1)
}

// Load meets once session resolves to a signed-in user
watch(
  () => session.value?.data?.user,
  (user) => {
    if (user) loadMeets()
  },
  { immediate: true },
)
</script>

<template>
  <div class="page">
    <div class="container">
      <!-- QuizMeets -->
      <section class="section">
        <h2 class="section-title">QuizMeets</h2>

        <!-- Saved meets (signed in) -->
        <template v-if="session.data?.user">
          <p v-if="loadingMeets" class="state-msg">Loading…</p>
          <p v-else-if="meetsError" class="state-msg state-msg--error">{{ meetsError }}</p>
          <ul v-else-if="memberships.length" class="qm-list">
            <li v-for="m in memberships" :key="m.meetId" class="qm-row">
              <button
                class="qm-name"
                @click="router.push({ name: 'meet', params: { slug: m.viewerCode } })"
              >
                {{ m.meetName }}
              </button>
              <span class="qm-role">{{ m.role.replace('_', ' ') }}</span>
            </li>
          </ul>
        </template>

        <!-- Create meet (superuser) -->
        <template v-if="isSuperuser">
          <button
            v-if="!showCreateMeet"
            class="btn btn--secondary create-meet-btn"
            @click="showCreateMeet = true"
          >
            + Create meet
          </button>
          <form v-else class="create-meet-form" @submit.prevent="handleCreateMeet">
            <input v-model="meetForm.name" class="field-input" placeholder="Meet name" required />
            <div class="date-row">
              <input v-model="meetForm.dateFrom" class="field-input" type="date" required />
              <span class="date-sep">–</span>
              <input v-model="meetForm.dateTo" class="field-input" type="date" />
            </div>
            <input
              v-model="meetForm.viewerCode"
              class="field-input"
              placeholder="Viewer code (e.g. fall-2025)"
              required
            />
            <div class="divisions-edit">
              <span class="divisions-label">Divisions</span>
              <div v-for="(_, i) in meetForm.divisions" :key="i" class="division-field">
                <input
                  v-model="meetForm.divisions[i]"
                  class="field-input"
                  placeholder="Division name"
                />
                <button
                  v-if="meetForm.divisions.length > 1"
                  type="button"
                  class="division-remove"
                  @click="removeDivisionField(i)"
                >
                  &times;
                </button>
              </div>
              <button type="button" class="btn btn--secondary btn--sm" @click="addDivisionField">
                + Division
              </button>
            </div>
            <p v-if="createMeetError" class="field-error">{{ createMeetError }}</p>
            <div class="form-actions">
              <button type="button" class="btn btn--secondary" @click="showCreateMeet = false">
                Cancel
              </button>
              <button type="submit" class="btn btn--primary" :disabled="creatingMeet">
                {{ creatingMeet ? 'Creating…' : 'Create' }}
              </button>
            </div>
          </form>
        </template>

        <!-- Code entry (everyone) -->
        <form class="code-form" @submit.prevent="handleCode">
          <input
            v-model="code"
            class="code-input"
            placeholder="Enter a code to join or view a meet"
            :disabled="submitting"
            required
          />
          <button type="submit" class="btn btn--primary" :disabled="submitting || !code.trim()">
            {{ submitting ? '…' : 'Go' }}
          </button>
        </form>
        <p v-if="codeError" class="field-error">{{ codeError }}</p>

        <p v-if="!session.data?.user" class="sign-in-hint">
          Sign in to save QuizMeets to your account.
        </p>
      </section>

      <!-- Scoresheet -->
      <section class="section">
        <h2 class="section-title">Scoresheet</h2>
        <p class="section-desc">
          Score quizzes in the browser or as a desktop app. Full rule support — toss-ups, A/B
          columns, fouls, bonuses, and overtime. No account needed.
        </p>
        <div class="scoresheet-actions">
          <a :href="scoresheetUrl" class="btn btn--primary">Open in browser</a>
          <a
            href="https://github.com/TommyAmberson/qzr-sheet/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn--secondary"
          >
            Download desktop app
          </a>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 2.5rem 0;
}

.container {
  max-width: 48rem;
  margin: 0 auto;
  padding: 0 1.5rem;
}

.section {
  margin-bottom: 2.5rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-bottom: 1rem;
}

.section-desc {
  font-size: 0.9rem;
  color: var(--color-text-muted);
  line-height: 1.65;
  max-width: 36rem;
  margin-bottom: 1.25rem;
}

/* Meet list */
.qm-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.875rem;
}

.qm-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.875rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  transition: border-color 0.15s;
}

.qm-row:hover {
  border-color: var(--color-accent);
}

.qm-name {
  flex: 1;
  background: none;
  border: none;
  padding: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.qm-role {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  text-transform: capitalize;
}

/* Code entry */
.code-form {
  display: flex;
  gap: 0.5rem;
  max-width: 28rem;
}

.code-input {
  flex: 1;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.4rem 0.65rem;
  font-size: 0.875rem;
  color: var(--color-text);
  font-family: inherit;
  outline: none;
}

.code-input:focus {
  border-color: var(--color-accent);
}

.field-error {
  font-size: 0.8rem;
  color: var(--palette-error);
  margin-top: 0.4rem;
}

.sign-in-hint {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  margin-top: 0.75rem;
}

.link {
  color: var(--color-accent);
  text-decoration: none;
}

.link:hover {
  text-decoration: underline;
}

/* Scoresheet */
.scoresheet-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid transparent;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
  white-space: nowrap;
}

.btn--primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: var(--color-accent);
}

.btn--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
  text-decoration: none;
  color: var(--color-bg);
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.btn--secondary:hover:not(:disabled) {
  border-color: var(--color-text-muted);
  color: var(--color-text);
  text-decoration: none;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn--sm {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
  margin-bottom: 0.875rem;
}

.state-msg--error {
  color: var(--palette-error);
}

/* Create meet */
.create-meet-btn {
  margin-bottom: 0.875rem;
}

.create-meet-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-width: 28rem;
  margin-bottom: 1rem;
  padding: 1rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
}

.date-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.date-sep {
  color: var(--color-text-faint);
  font-size: 0.85rem;
}

.divisions-edit {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.divisions-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.division-field {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.division-remove {
  background: none;
  border: none;
  padding: 0 0.25rem;
  font-size: 1rem;
  cursor: pointer;
  color: var(--color-text-faint);
  font-family: inherit;
}

.division-remove:hover {
  color: var(--palette-error);
}

.form-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
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
</style>
