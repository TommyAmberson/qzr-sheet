<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { getMyMeets, joinMeet, type MeetMembership } from '../api'

const scoresheetUrl = __SCORESHEET_URL__
const router = useRouter()
const { session } = useAuth()

const memberships = ref<MeetMembership[]>([])
const loadingMeets = ref(false)
const meetsError = ref('')

const joinCode = ref('')
const joining = ref(false)
const joinError = ref('')

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

async function handleJoin() {
  joinError.value = ''
  joining.value = true
  try {
    const res = await joinMeet(joinCode.value.trim())
    joinCode.value = ''
    router.push({ name: 'meet', params: { id: res.meet.id } })
  } catch (e) {
    joinError.value = (e as Error).message
  } finally {
    joining.value = false
  }
}

onMounted(loadMeets)
</script>

<template>
  <div class="page">
    <div class="container">
      <!-- QuizMeets — signed in -->
      <template v-if="session.data?.user">
        <div class="section-header">
          <h2 class="section-title">QuizMeets</h2>
        </div>

        <p v-if="loadingMeets" class="state-msg">Loading…</p>
        <p v-else-if="meetsError" class="state-msg state-msg--error">{{ meetsError }}</p>
        <p v-else-if="memberships.length === 0" class="state-msg">No QuizMeets yet.</p>
        <ul v-else class="qm-list">
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

        <form class="join-form" @submit.prevent="handleJoin">
          <input
            v-model="joinCode"
            class="join-input"
            placeholder="Join with a code…"
            :disabled="joining"
            required
          />
          <button type="submit" class="btn btn--secondary" :disabled="joining || !joinCode.trim()">
            {{ joining ? 'Joining…' : 'Join' }}
          </button>
        </form>
        <p v-if="joinError" class="join-error">{{ joinError }}</p>
      </template>

      <!-- Signed out -->
      <template v-else>
        <div class="intro">
          <h1 class="intro-heading">qzr</h1>
          <p class="intro-sub">Bible Quiz scoresheet and meet management.</p>
          <div class="intro-actions">
            <a :href="scoresheetUrl" class="btn btn--primary">Open Scoresheet</a>
            <a
              href="https://github.com/TommyAmberson/qzr-sheet/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--secondary"
            >
              Desktop app
            </a>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 3rem 0;
}

.container {
  max-width: 48rem;
  margin: 0 auto;
  padding: 0 1.5rem;
}

/* Signed-in: QuizMeets list */
.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.section-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
  margin-bottom: 1.25rem;
}

.state-msg--error {
  color: var(--palette-error);
}

.qm-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 1.5rem;
}

.qm-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 1rem;
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

.join-form {
  display: flex;
  gap: 0.5rem;
}

.join-input {
  flex: 1;
  max-width: 20rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.4rem 0.65rem;
  font-size: 0.875rem;
  color: var(--color-text);
  font-family: inherit;
  outline: none;
}

.join-input:focus {
  border-color: var(--color-accent);
}

.join-error {
  font-size: 0.8rem;
  color: var(--palette-error);
  margin-top: 0.4rem;
}

/* Signed-out intro */
.intro {
  padding: 2rem 0;
}

.intro-heading {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--color-heading);
  margin-bottom: 0.5rem;
}

.intro-sub {
  font-size: 0.95rem;
  color: var(--color-text-muted);
  margin-bottom: 1.75rem;
}

.intro-actions {
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

.btn--primary:hover {
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
</style>
