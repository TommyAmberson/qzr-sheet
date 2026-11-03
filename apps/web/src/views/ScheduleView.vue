<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError, MeetRole, type ScheduleDocument } from '@qzr/shared'
import { ScheduleSheet } from '@qzr/ui'

import { getMeet, getMyMeets, getPublishedSchedule, type QuizMeet } from '../api'

/**
 * A meet's published schedule (FR-050): letters or team names as the API says for the meet's phase
 * (FR-052), each quiz linking to the scoresheet.
 */
const props = defineProps<{ slug: string }>()
const router = useRouter()

declare const __SCORESHEET_URL__: string

const meet = ref<QuizMeet | null>(null)
const isAdmin = ref(false)
const doc = shallowRef<ScheduleDocument | null>(null)
const view = ref<'letters' | 'teams'>('letters')
const loading = ref(true)
const error = ref('')
const unpublished = ref(false)

const divisions = computed(
  () => doc.value?.settings.divisions.length ?? meet.value?.divisions.length ?? 0,
)

/** The scoresheet opens a schedule quiz by the meet and the quiz's id in the schedule */
function scoresheetHref(quizId: string): string {
  if (!meet.value) return '#'
  return `${__SCORESHEET_URL__}?meetId=${meet.value.id}&quiz=${encodeURIComponent(quizId)}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [detail, mine] = await Promise.all([getMeet(props.slug), getMyMeets()])
    meet.value = detail.meet
    const role = mine.memberships.find((m) => m.meetId === detail.meet.id)?.role
    isAdmin.value = role === MeetRole.Admin || role === MeetRole.Superuser
    try {
      const published = await getPublishedSchedule(detail.meet.id)
      doc.value = published.document
      view.value = published.view
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e
      unpublished.value = true
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
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
        <div class="meet-info">
          <h2 class="page-title">Schedule: {{ meet.name }}</h2>
          <span class="meet-meta">
            {{ meet.dateFrom }}{{ meet.dateTo ? ` – ${meet.dateTo}` : '' }} ·
            {{ divisions }} divisions
          </span>
        </div>
        <button
          v-if="isAdmin"
          type="button"
          class="edit-link no-print"
          @click="router.push({ name: 'meet-schedule-edit', params: { slug } })"
        >
          Edit →
        </button>
      </div>

      <p v-if="unpublished" class="state-msg">The schedule hasn't been published yet.</p>
      <ScheduleSheet v-else-if="doc" class="published" :doc="doc" :view="view">
        <template #quiz-title="{ quiz }">
          <a class="quiz-title" :href="scoresheetHref(quiz.id)">{{ quiz.label }}</a>
        </template>
      </ScheduleSheet>
    </template>
  </div>
</template>

<style scoped>
.container {
  max-width: 64rem;
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
  margin-bottom: 1.25rem;
}

.meet-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
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

.edit-link {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.35rem 0.75rem;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-muted);
  cursor: pointer;
  white-space: nowrap;
}

.edit-link:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

@media print {
  .no-print {
    display: none !important;
  }
  .container {
    max-width: none;
    padding: 0;
  }
  .back-link {
    display: none;
  }
}
</style>
