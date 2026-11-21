<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { DayQuiz } from '@qzr/shared'
import { ScheduleList, ScheduleSheet, type ScheduleMarks } from '@qzr/ui'

import QuizTitle from './QuizTitle.vue'
import { useScheduleClock } from './useScheduleClock'
import { useMeetPage } from '../../meetPage'
import { problemText } from '../../stats'
import { phone } from '../../viewport'

/**
 * The Schedule tab (FR-008): the meet's published schedule, letters or team names as the API says
 * for the meet's phase, with the meet day's results and settled benches on it.
 */
const router = useRouter()
const route = useRoute()
const { slug, meet, isAdmin, division, inScheduleDivision, published, day } = useMeetPage()

/** The schedule shown: the picked division's quizzes, or every division's (FR-004) */
const shown = computed(() => {
  const all = published.value?.document
  return all && { ...all, quizzes: all.quizzes.filter((q) => inScheduleDivision(q.division)) }
})

/** The meet day's results and settled benches on the sheet (FR-009 to FR-011) */
const marks = computed<ScheduleMarks | null>(() =>
  day.value
    ? { quizzes: new Map(day.value.quizzes.map((q) => [q.id, q])), benches: day.value.benches }
    : null,
)

/** What is wrong with a quiz, for an admin or its room's official, who are given its problems */
const statusTitle = (quiz: DayQuiz) => (quiz.problems ?? []).map(problemText).join('\n')

const storedOf = (quizId: string) => marks.value?.quizzes.get(quizId)?.storedId

// On a phone, a list by time with the slot under way marked (FR-021)
const { now, timeZone, times } = useScheduleClock(published, meet)
</script>

<template>
  <div class="schedule-tab">
    <p v-if="published === undefined" class="state-msg">Loading…</p>
    <template v-else>
      <div class="tab-tools no-print">
        <!-- The schedule alone, for a screen in the room -->
        <RouterLink
          v-if="published"
          class="edit-link"
          :to="{ name: 'meet-display', params: { slug }, query: route.query }"
          >Display</RouterLink
        >
        <button
          v-if="isAdmin"
          type="button"
          class="edit-link"
          @click="router.push({ name: 'meet-schedule-edit', params: { slug } })"
        >
          Edit →
        </button>
      </div>
      <p v-if="published === null" class="state-msg">The schedule hasn't been published yet.</p>
      <ScheduleList
        v-else-if="shown && phone"
        :doc="shown"
        :view="published.view"
        :marks="marks"
        :times="times"
        :now="now.getTime()"
        :time-zone="timeZone"
        :with-division="division === null && published.document.settings.divisions.length > 1"
        :status-title="statusTitle"
      >
        <template #quiz-title="{ quiz }">
          <QuizTitle :quiz="quiz" :stored-id="storedOf(quiz.id)" />
        </template>
      </ScheduleList>
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
            <QuizTitle :quiz="quiz" :stored-id="storedOf(quiz.id)" />
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
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.tab-tools:empty {
  display: none;
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
