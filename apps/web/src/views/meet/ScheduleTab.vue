<script setup lang="ts">
import { scoresheetLink } from '../../scoresheetLink'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { DayQuiz } from '@qzr/shared'
import { ScheduleSheet, type ScheduleMarks } from '@qzr/ui'

import { useMeetPage } from '../../meetPage'
import { problemText } from '../../stats'

/**
 * The Schedule tab (FR-008): the meet's published schedule, letters or team names as the API says
 * for the meet's phase, with the meet day's results and settled benches on it.
 */
const router = useRouter()
const { slug, isAdmin, sender, inDivision, published, day, scoresheetHref } = useMeetPage()

/** The schedule shown: the picked division's quizzes, or every division's (FR-004) */
const shown = computed(() => {
  const all = published.value?.document
  if (!all) return null
  // A schedule linked to the meet names its divisions as the meet does
  const named = new Map(all.settings.divisions.map((d) => [d.id, d.name]))
  return {
    ...all,
    quizzes: all.quizzes.filter((q) => inDivision(named.get(q.division) ?? q.division)),
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
const storedOf = (quizId: string) => marks.value?.quizzes.get(quizId)?.storedId
</script>

<template>
  <div class="schedule-tab">
    <p v-if="published === undefined" class="state-msg">Loading…</p>
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
      <p v-if="published === null" class="state-msg">The schedule hasn't been published yet.</p>
      <div v-else-if="shown" class="sheet-scroll">
        <ScheduleSheet
          class="published"
          :doc="shown"
          :view="published.view"
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
