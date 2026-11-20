<script setup lang="ts">
import type { ScheduleQuiz } from '@qzr/shared'
import { useMeetPage } from '../../meetPage'
import { scoresheetLink } from '../../scoresheetLink'

/**
 * A scheduled quiz's title on the Schedule tab (FR-012): its stored quiz's page where it has one the
 * reader may open, the scoresheet for one not in yet for those who score, or plain text
 */
defineProps<{
  quiz: ScheduleQuiz
  /** The stored quiz, where the reader is told it */
  storedId?: number
}>()

const { slug, scores, scoresheetHref } = useMeetPage()
</script>

<template>
  <RouterLink
    v-if="storedId !== undefined"
    class="quiz-title"
    :to="{ name: 'meet-result', params: { slug, resultId: storedId } }"
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
