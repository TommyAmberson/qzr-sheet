<script setup lang="ts">
import { scoresheetLink } from '../../scoresheetLink'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ApiError,
  sameDivision,
  type DayQuiz,
  type ScheduleDocument,
  type SheetView,
} from '@qzr/shared'
import { ScheduleSheet, type ScheduleMarks } from '@qzr/ui'

import { getPublishedSchedule } from '../../api'
import { useMeetPage } from '../../meetPage'
import { problemText } from '../../stats'

/**
 * The Schedule tab (FR-008): the meet's published schedule, letters or team names as the API says
 * for the meet's phase, each quiz linking to the scoresheet. Read again when the meet day names a
 * newer published version.
 */
const router = useRouter()
const { slug, meet, isAdmin, sender, division, day } = useMeetPage()

declare const __SCORESHEET_URL__: string

const doc = shallowRef<ScheduleDocument | null>(null)
const view = ref<SheetView>('letters')
const loading = ref(true)
const error = ref('')
const unpublished = ref(false)
/** The published version shown; the meet day names a newer one once it is published */
let shownVersion: number | null = null

/** The schedule shown: the picked division's quizzes, or every division's (FR-004) */
const shown = computed(() => {
  const all = doc.value
  if (!all || division.value === null) return all
  const picked = division.value
  const ids = new Set(
    all.settings.divisions.filter((d) => sameDivision(d.name, picked)).map((d) => d.id),
  )
  // A schedule linked to the meet names its divisions as the meet does
  return {
    ...all,
    quizzes: all.quizzes.filter((q) => ids.has(q.division) || sameDivision(q.division, picked)),
  }
})

/** The meet day's results and settled benches on the sheet (FR-009 to FR-011) */
const marks = computed<ScheduleMarks | null>(() =>
  day.value
    ? { quizzes: new Map(day.value.quizzes.map((q) => [q.id, q])), benches: day.value.benches }
    : null,
)

/** What is wrong with a quiz, for an admin or its room's official, who are given its problems */
const statusTitle = (quiz: DayQuiz) => (quiz.problems ?? []).map(problemText).join('\n')

/** Admins and the meet's officials score quizzes, so a quiz not in yet opens the scoresheet */
const scores = computed(() => isAdmin.value || (sender.value?.rooms.length ?? 0) > 0)
const storedOf = (quizId: string) => day.value?.quizzes.find((q) => q.id === quizId)?.storedId

/** The scoresheet opens a schedule quiz by the meet and the quiz's id in the schedule */
function scoresheetHref(quizId: string): string {
  if (!meet.value) return '#'
  return `${__SCORESHEET_URL__}?meetId=${meet.value.id}&quiz=${encodeURIComponent(quizId)}`
}

async function load(meetId: number) {
  error.value = ''
  try {
    const published = await getPublishedSchedule(meetId)
    doc.value = published.document
    view.value = published.view
    unpublished.value = false
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) unpublished.value = true
    else error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => meet.value?.id,
  (id) => {
    if (id !== undefined) void load(id)
  },
  { immediate: true },
)

watch(
  () => day.value?.scheduleVersion ?? null,
  (version) => {
    const id = meet.value?.id
    if (id === undefined || version === shownVersion) return
    if (shownVersion !== null || (version !== null && unpublished.value)) void load(id)
    shownVersion = version
  },
)
</script>

<template>
  <div class="schedule-tab">
    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>
    <template v-else>
      <div v-if="isAdmin" class="tab-tools no-print">
        <button
          type="button"
          class="edit-link"
          @click="router.push({ name: 'meet-schedule-edit', params: { slug } })"
        >
          Edit →
        </button>
      </div>
      <p v-if="unpublished" class="state-msg">The schedule hasn't been published yet.</p>
      <div v-else-if="doc" class="sheet-scroll">
        <ScheduleSheet
          class="published"
          :doc="shown!"
          :view="view"
          :marks="marks"
          :status-title="statusTitle"
        >
          <!-- A stored quiz opens its page; one not in yet, the scoresheet for those who score (FR-012) -->
          <template #quiz-title="{ quiz }">
            <RouterLink
              v-if="storedOf(quiz.id) !== undefined"
              class="quiz-title"
              :to="{ name: 'meet-result', params: { slug, resultId: storedOf(quiz.id) } }"
              >{{ quiz.label }}</RouterLink
            >
            <a
              v-else-if="scores"
              class="quiz-title"
              :href="scoresheetHref(quiz.id)"
              v-bind="scoresheetLink"
              >{{ quiz.label }}</a
            >
            <span v-else class="quiz-title">{{ quiz.label }}</span>
          </template>
        </ScheduleSheet>
      </div>
    </template>
  </div>
</template>

<style scoped>
.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
}

.state-msg--error {
  color: var(--palette-error);
}

/* The sheet scrolls in its own box, so the page and its header stay put on a narrow screen. Once
   the header scrolls away the box fills the window, with room names and times in view. A sheet
   narrower than the window sits in its centre */
.sheet-scroll {
  position: sticky;
  top: 0;
  width: fit-content;
  max-width: 100%;
  max-height: 100vh;
  max-height: 100dvh;
  margin-inline: auto;
  overflow: auto;
}

.tab-tools {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
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
  .sheet-scroll {
    position: static;
    max-height: none;
    overflow: visible;
  }
}
</style>
