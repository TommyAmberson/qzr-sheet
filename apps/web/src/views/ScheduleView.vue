<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  getMeet,
  listMeetRooms,
  listMeetSlots,
  listScheduledQuizzes,
  type MeetDetail,
  type MeetRoom,
  type MeetSlot,
  type ScheduledQuiz,
} from '../api'
import ScheduleGrid from '../components/ScheduleGrid.vue'

const props = defineProps<{ slug: string }>()
const router = useRouter()

const detail = ref<MeetDetail | null>(null)
const rooms = ref<MeetRoom[]>([])
const slots = ref<MeetSlot[]>([])
const quizzes = ref<ScheduledQuiz[]>([])
const loading = ref(true)
const error = ref('')
const divisionFilter = ref<string | null>(null)

const meet = computed(() => detail.value?.meet ?? null)
const divisions = computed(() => meet.value?.divisions ?? [])

async function load() {
  loading.value = true
  error.value = ''
  try {
    const meetDetail = await getMeet(props.slug)
    detail.value = meetDetail
    const meetId = meetDetail.meet.id
    const [r, s, q] = await Promise.all([
      listMeetRooms(meetId),
      listMeetSlots(meetId),
      listScheduledQuizzes(meetId),
    ])
    rooms.value = r.rooms
    slots.value = s.slots
    quizzes.value = q.quizzes
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
    <button class="back-link" @click="router.push({ name: 'meet', params: { slug } })">
      ← {{ meet?.name || 'QuizMeet' }}
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet">
      <div class="page-header">
        <h2 class="page-title">Schedule</h2>
        <span class="meet-name">{{ meet.name }}</span>
      </div>

      <div v-if="divisions.length > 1" class="filter-row">
        <label class="filter-label" for="division-filter">Division</label>
        <select id="division-filter" v-model="divisionFilter" class="filter-select">
          <option :value="null">All</option>
          <option v-for="d in divisions" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>

      <ScheduleGrid
        :rooms="rooms"
        :slots="slots"
        :quizzes="quizzes"
        :division-filter="divisionFilter"
      />
    </template>
  </div>
</template>

<style scoped>
.container {
  max-width: 64rem;
  margin: 0 auto;
  padding: 1rem;
}

.back-link {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font: inherit;
  cursor: pointer;
  padding: 0.25rem 0;
  margin-bottom: 0.5rem;
}

.back-link:hover {
  color: var(--color-text);
}

.state-msg {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  padding: 1rem 0;
}

.state-msg--error {
  color: var(--color-invalid, #c00);
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: 1rem;
}

.page-title {
  font-size: 1.4rem;
  margin: 0;
}

.meet-name {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.filter-label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.filter-select {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
}
</style>
