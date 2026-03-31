<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getMeet, getMyMeets, type MeetDetail, type MeetMembership } from '../api'

const props = defineProps<{ id: number }>()
const router = useRouter()

const detail = ref<MeetDetail | null>(null)
const membership = ref<MeetMembership | null>(null)
const loading = ref(true)
const error = ref('')

const role = computed(() => membership.value?.role ?? null)
const isAdmin = computed(() => role.value === 'admin')
const isCoach = computed(() => role.value === 'head_coach' || role.value === 'admin')

async function load() {
  try {
    const [detailRes, myMeetsRes] = await Promise.all([getMeet(props.id), getMyMeets()])
    detail.value = detailRes
    membership.value = myMeetsRes.memberships.find((m) => m.meetId === props.id) ?? null

    // No access — redirect home
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

onMounted(load)
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'home' })">← QuizMeets</button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="detail">
      <div class="page-header">
        <h2 class="page-title">{{ detail.meet.name }}</h2>
        <span class="meet-meta">
          {{ detail.meet.dateFrom
          }}{{
            detail.meet.dateTo && detail.meet.dateTo !== detail.meet.dateFrom
              ? ` – ${detail.meet.dateTo}`
              : ''
          }}
        </span>
        <span class="meet-divisions">{{ detail.meet.divisions.join(', ') }}</span>
      </div>

      <div class="card-grid">
        <button
          v-if="isCoach"
          class="card"
          @click="router.push({ name: 'meet-teams', params: { id } })"
        >
          <span class="card-title">Teams &amp; Rosters</span>
          <span class="card-desc">Manage churches, teams, and quizzers</span>
        </button>

        <button
          v-if="isAdmin"
          class="card"
          @click="router.push({ name: 'meet-admin', params: { id } })"
        >
          <span class="card-title">QuizMeet Settings</span>
          <span class="card-desc">Edit details, manage join codes</span>
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
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 2rem;
}

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.meet-meta,
.meet-divisions {
  font-size: 0.8rem;
  color: var(--color-text-faint);
}

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
</style>
