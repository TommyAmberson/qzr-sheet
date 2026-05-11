<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { estimateLaneQuizzes } from '../brackets'
import ElimSetupSection from '../components/schedule/ElimSetupSection.vue'
import PrelimSetupSection from '../components/schedule/PrelimSetupSection.vue'
import ReviewSection from '../components/schedule/ReviewSection.vue'
import SkeletonSection from '../components/schedule/SkeletonSection.vue'
import { useScheduleData } from '../composables/useScheduleData'

const props = defineProps<{ slug: string }>()
const router = useRouter()
const route = useRoute()

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
} = useScheduleData(toRef(props, 'slug'))

const editable = ref(false)

type TabId = 'prelim' | 'elim' | 'skeleton' | 'review'
const TABS: { id: TabId; label: string }[] = [
  { id: 'prelim', label: 'Prelim setup' },
  { id: 'elim', label: 'Elim setup' },
  { id: 'skeleton', label: 'Skeleton' },
  { id: 'review', label: 'Review' },
]
const VALID_TABS = new Set<TabId>(TABS.map((t) => t.id))

function tabFromHash(hash: string): TabId {
  const id = hash.replace(/^#/, '')
  return VALID_TABS.has(id as TabId) ? (id as TabId) : 'review'
}

const activeTab = ref<TabId>(tabFromHash(route.hash))

watch(
  () => route.hash,
  (h) => {
    activeTab.value = tabFromHash(h)
  },
)

function selectTab(tab: TabId) {
  activeTab.value = tab
  router.replace({ ...route, hash: `#${tab}` })
}

/** Total quiz budget across all divisions: prelims (= team count) + elim
 *  estimates per enabled lane. Threaded down so SkeletonSection can show
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
            <span>Schedule</span>
            <span class="masthead-rule" aria-hidden="true">·</span>
            <span>{{ meet.dateFrom }}{{ meet.dateTo ? ` – ${meet.dateTo}` : '' }}</span>
            <span class="masthead-rule" aria-hidden="true">·</span>
            <span>{{ divisions.length }} divisions</span>
          </p>
        </div>
        <div v-if="isAdmin" class="masthead-actions no-print">
          <button class="link-btn" @click="editable = !editable">
            {{ editable ? 'Stop editing' : 'Edit' }}
          </button>
        </div>
      </header>

      <nav class="tabs" role="tablist" aria-label="Schedule sections">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'is-active': activeTab === tab.id }"
          :aria-selected="activeTab === tab.id"
          @click="selectTab(tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <PrelimSetupSection
        v-if="activeTab === 'prelim'"
        :divisions="divisions"
        :team-counts="teamCounts"
        :editable="editable && isAdmin"
      />

      <ElimSetupSection
        v-else-if="activeTab === 'elim'"
        :divisions="divisions"
        :team-counts="teamCounts"
        :extra-lanes="extraLanes"
        :editable="editable && isAdmin"
        @toggle-lane="toggleLane"
        @resize-lane="resizeLane"
      />

      <SkeletonSection
        v-else-if="activeTab === 'skeleton'"
        :rooms="rooms"
        :slots="slots"
        :quiz-budget="quizBudget"
        :editable="editable && isAdmin"
      />

      <ReviewSection v-else :rooms="rooms" :slots="slots" :quizzes="quizzes" />
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

.tabs {
  display: flex;
  gap: 1.5rem;
  margin-top: 0.85rem;
  overflow-x: auto;
}

.tab {
  background: none;
  border: none;
  font: inherit;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.05rem;
  letter-spacing: -0.005em;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.55rem 0;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  transition:
    color 120ms ease,
    border-color 120ms ease;
}

.tab:hover {
  color: var(--color-text-muted);
}

.tab.is-active {
  color: var(--color-text);
  border-bottom-color: var(--color-text);
}

@media print {
  .tabs {
    display: none;
  }
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
