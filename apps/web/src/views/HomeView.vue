<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { getMyMeets, joinMeet, joinMeetGuest, type MeetMembership } from '../api'

const scoresheetUrl = __SCORESHEET_URL__
const router = useRouter()
const { session } = useAuth()

const memberships = ref<MeetMembership[]>([])
const loadingMeets = ref(false)
const meetsError = ref('')

const code = ref('')
const submitting = ref(false)
const codeError = ref('')

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
      router.push({ name: 'meet', params: { id: res.meet.id } })
    } else {
      const res = await joinMeetGuest(c)
      code.value = ''
      // TODO: store the guest JWT (res.token) for API calls on the meet page
      router.push({ name: 'meet', params: { id: res.meet.id } })
    }
  } catch (e) {
    codeError.value = (e as Error).message
  } finally {
    submitting.value = false
  }
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
                @click="router.push({ name: 'meet', params: { id: m.meetId } })"
              >
                {{ m.meetName }}
              </button>
              <span class="qm-role">{{ m.role.replace('_', ' ') }}</span>
            </li>
          </ul>
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

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
  margin-bottom: 0.875rem;
}

.state-msg--error {
  color: var(--palette-error);
}
</style>
