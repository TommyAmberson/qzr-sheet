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
  <div>
    <!-- Hero -->
    <section class="hero">
      <div class="container">
        <div class="wip-badge">Early development</div>
        <h1 class="hero-heading">Bible Quiz tools</h1>
        <p class="hero-sub">
          A scoresheet for Bible Quiz — meets, practices, or anything in between. A meet management
          platform is in the works. No name yet.
        </p>
        <div class="hero-actions">
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
    </section>

    <!-- QuizMeets (signed-in users) -->
    <section v-if="session.data?.user" class="section section--quizmeeets">
      <div class="container">
        <h2 class="section-heading">Your QuizMeets</h2>

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

        <div class="join-form-wrap">
          <h3 class="join-title">Join a QuizMeet</h3>
          <form class="join-form" @submit.prevent="handleJoin">
            <input
              v-model="joinCode"
              class="join-input"
              placeholder="Enter code"
              :disabled="joining"
              required
            />
            <button type="submit" class="btn btn--primary" :disabled="joining || !joinCode.trim()">
              {{ joining ? 'Joining…' : 'Join' }}
            </button>
          </form>
          <p v-if="joinError" class="join-error">{{ joinError }}</p>
        </div>
      </div>
    </section>

    <!-- Scoresheet -->
    <section class="section">
      <div class="container">
        <h2 class="section-heading">qzr-sheet <span class="badge badge--done">Available</span></h2>
        <p class="section-desc">
          A scoresheet for quiz meets and practices. Works in the browser or as a native desktop app
          on Windows, macOS, and Linux.
        </p>
        <ul class="feature-list">
          <li>
            Correct answers, errors, fouls, and bonuses — full rule support including toss-ups, A/B
            columns, foul-outs, and overtime
          </li>
          <li>Running team scores and placement points update as you go</li>
          <li>Validation catches illegal cell states with inline messages</li>
          <li>Keyboard navigation, undo/redo, drag reorder</li>
          <li>Auto-saves to localStorage; export and import JSON or ODS</li>
          <li>Fully offline — no account, no server</li>
        </ul>
      </div>
    </section>

    <!-- Platform -->
    <section class="section section--muted">
      <div class="container">
        <h2 class="section-heading">
          Meet platform <span class="badge badge--planned">Planned</span>
        </h2>
        <p class="section-desc">
          The scoresheet is standalone today. The goal is to connect it to a platform that handles
          the rest of what a quiz meet needs.
        </p>
        <div class="roadmap">
          <div class="roadmap-item">
            <span class="roadmap-label">Standings and stats</span>
            <p class="roadmap-desc">
              Submitted scoresheets feed into team and individual stats. Coaches, quizzers, and
              spectators can follow along from their phones without needing an account.
            </p>
          </div>
          <div class="roadmap-item">
            <span class="roadmap-label">Schedule</span>
            <p class="roadmap-desc">
              Published round schedules showing which teams are in which rooms. Officials see their
              assigned quizzes; coaches see when their teams are up.
            </p>
          </div>
          <div class="roadmap-item">
            <span class="roadmap-label">Rosters</span>
            <p class="roadmap-desc">
              Coaches register churches, build team rosters, and link quizzers to a persistent
              identity for cross-meet career stats.
            </p>
          </div>
          <div class="roadmap-item">
            <span class="roadmap-label">Official flow</span>
            <p class="roadmap-desc">
              Load assigned quiz details directly into the scoresheet and submit results when done.
              No manual data entry after the fact.
            </p>
          </div>
          <div class="roadmap-item">
            <span class="roadmap-label">Meet administration</span>
            <p class="roadmap-desc">
              Create meets, manage room assignments, generate join codes for coaches and officials,
              and review submitted results.
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.container {
  max-width: 52rem;
  margin: 0 auto;
  padding: 0 1.5rem;
}

.section--quizmeeets {
  background: var(--color-bg-raised);
  border-bottom: 1px solid var(--color-border-alt);
}

.qm-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 1.5rem;
}

.qm-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.875rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
}

.qm-name {
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

.qm-name:hover {
  color: var(--color-accent-hover);
}

.qm-role {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  text-transform: capitalize;
}

.join-form-wrap {
  margin-top: 1rem;
}

.join-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 0.625rem;
}

.join-form {
  display: flex;
  gap: 0.5rem;
}

.join-input {
  flex: 1;
  max-width: 18rem;
  background: var(--color-bg);
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

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
  margin-bottom: 1rem;
}

.state-msg--error {
  color: var(--palette-error);
}

.section--hero {
  padding: 4rem 0 3.5rem;
  background: var(--color-bg-warm);
}

.wip-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  margin-bottom: 1.25rem;
}

.hero-heading {
  font-size: clamp(1.75rem, 5vw, 2.5rem);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: var(--color-heading);
  margin-bottom: 1rem;
}

.hero-sub {
  font-size: 1rem;
  color: var(--color-text-muted);
  max-width: 36rem;
  margin-bottom: 2rem;
  line-height: 1.65;
}

.hero-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.55rem 1.1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
  white-space: nowrap;
}

.btn--primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border: 1px solid var(--color-accent);
}

.btn--primary:hover {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
  color: var(--color-bg);
  text-decoration: none;
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.btn--secondary:hover {
  border-color: var(--color-text-muted);
  color: var(--color-text);
  text-decoration: none;
}

/* Sections */
.section {
  padding: 3rem 0;
  background: var(--color-bg);
}

.section--muted {
  background: var(--color-bg-warm);
  border-top: 1px solid var(--color-border-alt);
}

.section-heading {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-heading);
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.section-desc {
  font-size: 0.9rem;
  color: var(--color-text-muted);
  max-width: 36rem;
  line-height: 1.65;
  margin-bottom: 1.5rem;
}

.badge {
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 0.2rem 0.45rem;
  border-radius: 4px;
}

.badge--done {
  background: var(--color-correct);
  color: var(--palette-correct-alt);
}

.badge--planned {
  background: var(--color-border-alt);
  color: var(--color-text-faint);
}

/* Feature list */
.feature-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.feature-list li {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  padding-left: 1.1rem;
  position: relative;
  line-height: 1.5;
}

.feature-list li::before {
  content: '–';
  position: absolute;
  left: 0;
  color: var(--color-border);
}

/* Roadmap */
.roadmap {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.roadmap-item {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.roadmap-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.roadmap-desc {
  font-size: 0.875rem;
  color: var(--color-text-faint);
  line-height: 1.6;
  max-width: 36rem;
}
</style>
