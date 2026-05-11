<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue'
import { useRouter } from 'vue-router'

import { estimateLaneQuizzes } from '../brackets'
import ElimSetupSection from '../components/schedule/ElimSetupSection.vue'
import PrelimSetupSection from '../components/schedule/PrelimSetupSection.vue'
import ReviewSection from '../components/schedule/ReviewSection.vue'
import SkeletonSection from '../components/schedule/SkeletonSection.vue'
import { useScheduleData } from '../composables/useScheduleData'

const props = defineProps<{ slug: string }>()
const router = useRouter()

const data = useScheduleData(toRef(props, 'slug'))
const {
  rooms,
  slots,
  quizzes,
  teamCounts,
  extraLanes,
  loading,
  error,
  meet,
  divisions,
  isAdmin,
  load,
  toggleLane,
  resizeLane,
} = data

const editable = ref(false)

/** Total quiz budget across all divisions: prelims (= team count) + elim
 *  estimates per enabled lane. Threaded down so CadenceSection can show
 *  capacity vs budget without recomputing. */
const quizBudget = computed(() => {
  let total = 0
  for (const d of divisions.value) {
    const teams = teamCounts.value[d] ?? 0
    const extras = extraLanes.value[d] ?? []
    const usedByExtras = extras.reduce((sum, l) => sum + l.teamCount, 0)
    const mainSize = Math.max(0, teams - usedByExtras)
    total += teams // prelim count = team count
    total += estimateLaneQuizzes(mainSize)
    for (const lane of extras) {
      total += estimateLaneQuizzes(lane.teamCount)
    }
  }
  return total
})

function backToV1() {
  router.replace({ name: 'meet-schedule', params: { slug: props.slug } })
}

onMounted(load)
</script>

<template>
  <div class="studio">
    <button class="back-link" @click="router.push({ name: 'meet', params: { slug } })">
      ← {{ meet?.name || 'QuizMeet' }}
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet">
      <header class="masthead">
        <div class="masthead-text">
          <h1 class="masthead-title">{{ meet.name }}</h1>
          <p class="masthead-meta">
            <span>Schedule Studio</span>
            <span class="masthead-rule" aria-hidden="true">·</span>
            <span>{{ meet.dateFrom }}{{ meet.dateTo ? ` – ${meet.dateTo}` : '' }}</span>
            <span class="masthead-rule" aria-hidden="true">·</span>
            <span>{{ divisions.length }} divisions</span>
          </p>
        </div>
        <div class="masthead-actions no-print">
          <button v-if="isAdmin" class="link-btn" @click="editable = !editable">
            {{ editable ? 'Stop editing' : 'Edit' }}
          </button>
          <button class="link-btn link-btn--quiet" @click="backToV1">
            Switch to V1 grid editor
          </button>
        </div>
      </header>

      <PrelimSetupSection
        :divisions="divisions"
        :team-counts="teamCounts"
        :editable="editable && isAdmin"
      />

      <ElimSetupSection
        :divisions="divisions"
        :team-counts="teamCounts"
        :extra-lanes="extraLanes"
        :editable="editable && isAdmin"
        @toggle-lane="toggleLane"
        @resize-lane="resizeLane"
      />

      <SkeletonSection
        :rooms="rooms"
        :slots="slots"
        :quiz-budget="quizBudget"
        :editable="editable && isAdmin"
      />

      <ReviewSection :rooms="rooms" :slots="slots" :quizzes="quizzes" />
    </template>
  </div>
</template>

<style scoped>
.studio {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 4rem;
}

.back-link {
  background: none;
  border: none;
  font: inherit;
  font-size: 0.78rem;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0;
  margin-bottom: 1.5rem;
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

.masthead {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid var(--color-text);
}

.masthead-text {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.masthead-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: clamp(2rem, 4vw, 2.85rem);
  line-height: 1.05;
  letter-spacing: -0.015em;
  margin: 0;
  color: var(--color-heading);
}

.masthead-meta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.6rem;
  align-items: baseline;
}

.masthead-rule {
  color: var(--color-border);
}

.masthead-actions {
  display: flex;
  gap: 1.25rem;
  align-items: center;
}

.link-btn {
  background: none;
  border: none;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text);
  cursor: pointer;
  padding: 0.3rem 0;
  border-bottom: 1px solid currentColor;
}

.link-btn:hover {
  color: var(--color-accent);
}

.link-btn--quiet {
  color: var(--color-text-faint);
  border-bottom-color: transparent;
}

.link-btn--quiet:hover {
  color: var(--color-text);
  border-bottom-color: currentColor;
}

@media print {
  .no-print {
    display: none !important;
  }
  .studio {
    padding: 0;
    max-width: none;
  }
  .back-link {
    display: none;
  }
}
</style>
