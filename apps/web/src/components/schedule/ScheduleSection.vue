<script setup lang="ts">
import { type MeetRoom, type MeetSlot, type ScheduledQuiz } from '../../api'

defineProps<{
  rooms: MeetRoom[]
  slots: MeetSlot[]
  quizzes: ScheduledQuiz[]
}>()
</script>

<template>
  <section class="schedule-section">
    <header class="section-head">
      <h2 class="section-title">Schedule</h2>
      <p class="section-meta">{{ quizzes.length }} quizzes · {{ slots.length }} slots</p>
    </header>
    <p class="placeholder">Section in progress.</p>
  </section>
</template>

<style scoped>
.schedule-section {
  padding: 1.25rem 0 1rem;
  border-top: 2px solid var(--color-text);
  margin-top: 1rem;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.section-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.45rem;
  margin: 0;
  letter-spacing: -0.01em;
  color: var(--color-heading);
}

.section-meta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--color-text-faint);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.placeholder {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--color-text-faint);
  margin: 0;
}
</style>
