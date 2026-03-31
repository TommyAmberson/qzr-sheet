<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getMyMeets, joinMeet, type MeetMembership } from '../api'

const router = useRouter()

const memberships = ref<MeetMembership[]>([])
const loading = ref(true)
const error = ref('')

const joinCode = ref('')
const joining = ref(false)
const joinError = ref('')

const coachMeets = ref<MeetMembership[]>([])

async function load() {
  try {
    const res = await getMyMeets()
    memberships.value = res.memberships
    coachMeets.value = res.memberships.filter((m) => m.role === 'head_coach' || m.role === 'admin')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function handleJoin() {
  joinError.value = ''
  joining.value = true
  try {
    await joinMeet(joinCode.value.trim())
    joinCode.value = ''
    await load()
  } catch (e) {
    joinError.value = (e as Error).message
  } finally {
    joining.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="container">
    <div class="page-header">
      <h2 class="page-title">My meets</h2>
    </div>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else>
      <p v-if="coachMeets.length === 0" class="state-msg">No meets yet — join one below.</p>
      <ul v-else class="meet-list">
        <li v-for="m in coachMeets" :key="m.meetId" class="meet-row">
          <button
            class="meet-name"
            @click="router.push({ name: 'coach-meet', params: { id: m.meetId } })"
          >
            {{ m.meetName }}
          </button>
        </li>
      </ul>

      <div class="join-section">
        <h3 class="section-title">Join a meet</h3>
        <form class="join-form" @submit.prevent="handleJoin">
          <input
            v-model="joinCode"
            class="field-input"
            placeholder="Enter coach code"
            :disabled="joining"
            required
          />
          <button type="submit" class="btn btn--primary" :disabled="joining || !joinCode.trim()">
            {{ joining ? 'Joining…' : 'Join' }}
          </button>
        </form>
        <p v-if="joinError" class="field-error">{{ joinError }}</p>
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
  margin-bottom: 1.5rem;
}

.state-msg--error {
  color: var(--palette-error);
}

.meet-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 2rem;
}

.meet-row {
  display: flex;
  align-items: center;
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

.join-section {
  margin-top: 2rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 0.75rem;
}

.join-form {
  display: flex;
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
  flex: 1;
}

.field-input:focus {
  border-color: var(--color-accent);
}

.field-error {
  font-size: 0.8rem;
  color: var(--palette-error);
  margin-top: 0.4rem;
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

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
