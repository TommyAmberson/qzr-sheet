<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type { SeatInput } from '../api'
import { estimateLaneQuizzes } from '../brackets'
import ElimSetupSection from '../components/schedule/ElimSetupSection.vue'
import PrelimSetupSection from '../components/schedule/PrelimSetupSection.vue'
import ReviewSection from '../components/schedule/ReviewSection.vue'
import SkeletonSection from '../components/schedule/SkeletonSection.vue'
import { useScheduleData } from '../composables/useScheduleData'
import { bySortOrder } from '../scheduleGrid'

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
  createSlot,
  updateSlot,
  deleteSlot,
  createQuiz,
  updateQuiz,
  deleteQuiz,
} = useScheduleData(toRef(props, 'slug'))

async function onCreateSlot(payload: {
  startAt: string
  durationMinutes: number
  kind: 'quiz' | 'event'
  eventLabel: string | null
  sortOrder: number
}) {
  try {
    await createSlot(payload)
  } catch (e) {
    alert((e as Error).message)
  }
}

async function onUpdateSlot(payload: {
  slotId: number
  patch: {
    startAt?: string
    durationMinutes?: number
    eventLabel?: string | null
  }
}) {
  try {
    await updateSlot(payload.slotId, payload.patch)
  } catch (e) {
    alert((e as Error).message)
  }
}

async function onDeleteSlot(slotId: number) {
  try {
    await deleteSlot(slotId)
  } catch (e) {
    alert((e as Error).message)
  }
}

async function onDeleteQuiz(quizId: number) {
  try {
    await deleteQuiz(quizId)
  } catch (e) {
    alert((e as Error).message)
  }
}

async function onAddQuiz(payload: {
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  seats: SeatInput[]
}) {
  try {
    await createQuiz(payload)
  } catch (e) {
    alert((e as Error).message)
  }
}

async function onUpdateQuiz(payload: {
  quizId: number
  patch: { label?: string }
  seats: SeatInput[]
}) {
  try {
    await updateQuiz(payload.quizId, payload.patch, payload.seats)
  } catch (e) {
    alert((e as Error).message)
  }
}

/** Compute the per-division quiz plan from prelim team counts and elim
 *  lane structure. Labels follow `D{div}-Q{n}` for prelims (numbered)
 *  and `D{div}-Q{A,B,C…}` for elims (lettered, since those are bracket
 *  positions like SF/F rather than ordered rounds). */
function computePopulationPlan(): Array<{
  division: string
  phase: 'prelim' | 'elim'
  label: string
}> {
  const plan: Array<{ division: string; phase: 'prelim' | 'elim'; label: string }> = []
  for (const div of divisions.value) {
    const teams = teamCounts.value[div] ?? 0
    const extras = extraLanes.value[div] ?? []
    const usedByExtras = extras.reduce((sum, l) => sum + l.teamCount, 0)
    const mainSize = Math.max(0, teams - usedByExtras)
    const elimCount =
      estimateLaneQuizzes(mainSize) +
      extras.reduce((sum, l) => sum + estimateLaneQuizzes(l.teamCount), 0)
    for (let i = 0; i < teams; i++) {
      plan.push({ division: div, phase: 'prelim', label: `D${div}-Q${i + 1}` })
    }
    for (let i = 0; i < elimCount; i++) {
      plan.push({ division: div, phase: 'elim', label: `D${div}-Q${String.fromCharCode(65 + i)}` })
    }
  }
  return plan
}

const populating = ref(false)

async function onPopulateSkeleton() {
  if (populating.value) return
  populating.value = true
  try {
    // Wipe existing quizzes (the user has already confirmed overwrite).
    for (const q of [...quizzes.value]) {
      await deleteQuiz(q.id)
    }

    const plan = computePopulationPlan()
    const quizSlots = slots.value.filter((s) => s.kind === 'quiz').sort(bySortOrder)
    if (quizSlots.length === 0 || rooms.value.length === 0) {
      alert('Add slots in Skeleton and rooms to the meet before populating.')
      return
    }

    const cells = plan.length
    const capacity = quizSlots.length * rooms.value.length
    if (cells > capacity) {
      const ok = confirm(`Need ${cells} cells but only ${capacity} are available. Truncate to fit?`)
      if (!ok) return
    }

    let i = 0
    for (const slot of quizSlots) {
      for (const room of rooms.value) {
        if (i >= plan.length) break
        const item = plan[i]!
        await createQuiz({
          slotId: slot.id,
          roomId: room.id,
          division: item.division,
          phase: item.phase,
          label: item.label,
          seats: [
            { seatNumber: 1, letter: 'A' },
            { seatNumber: 2, letter: 'B' },
            { seatNumber: 3, letter: 'C' },
          ],
        })
        i++
      }
    }
  } catch (e) {
    alert((e as Error).message)
  } finally {
    populating.value = false
  }
}

function onRollTeams() {
  alert('Roll Teams — coming soon. Will assign team letters to seats using a balanced rotation.')
}

type TabId = 'prelim' | 'elim' | 'skeleton' | 'draw'
const TABS: { id: TabId; label: string }[] = [
  { id: 'prelim', label: 'Prelim setup' },
  { id: 'elim', label: 'Elim setup' },
  { id: 'skeleton', label: 'Skeleton' },
  { id: 'draw', label: 'Draw' },
]
const VALID_TABS = new Set<TabId>(TABS.map((t) => t.id))

function tabFromHash(hash: string): TabId {
  const id = hash.replace(/^#/, '')
  return VALID_TABS.has(id as TabId) ? (id as TabId) : 'skeleton'
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

/** Capacity check fed into the Draw section's Populate card so the
 *  user can see if there's room before clicking. */
const populateInfo = computed(() => {
  const needed = computePopulationPlan().length
  const quizSlotCount = slots.value.filter((s) => s.kind === 'quiz').length
  const capacity = quizSlotCount * rooms.value.length
  let note: string
  let ready: boolean
  if (divisions.value.length === 0) {
    note = 'No divisions yet. Add team rosters in Churches first.'
    ready = false
  } else if (needed === 0) {
    note = 'Set team counts in Prelim setup and lane sizes in Elim setup.'
    ready = false
  } else if (quizSlotCount === 0) {
    note = 'Add quiz slots in Skeleton.'
    ready = false
  } else if (rooms.value.length === 0) {
    note = 'Add rooms to the meet on the dashboard.'
    ready = false
  } else if (capacity < needed) {
    note = `${needed - capacity} cells short — add slots or rooms (or remove some quizzes from the plan).`
    ready = false
  } else {
    const spare = capacity - needed
    note = spare === 0 ? 'Exact fit.' : `${spare} cell${spare === 1 ? '' : 's'} to spare.`
    ready = true
  }
  return { needed, capacity, ready, note }
})

/** Per-division prelim readiness check fed into the Roll Teams card.
 *  Roll Teams needs every prelim quiz already shaped like a valid
 *  round-robin: right number of quizzes, every team-letter appearing
 *  exactly 3 times (each team plays 3 prelims), no duplicate letters
 *  within a quiz, and pair co-occurrence balanced (max − min ≤ 1).
 *  Once those preconditions hold, the actual rolling step just maps
 *  letters to team identities. */
const rollInfo = computed(() => {
  const perDivision = divisions.value.map((division) => {
    const needed = teamCounts.value[division] ?? 0
    const prelims = quizzes.value.filter((q) => q.division === division && q.phase === 'prelim')
    const present = prelims.length
    const issue = checkPrelimRoundRobin(needed, prelims)
    return { division, needed, present, issue }
  })

  let note: string
  let ready: boolean
  if (perDivision.length === 0) {
    note = 'No divisions yet.'
    ready = false
  } else if (perDivision.every((d) => d.needed === 0)) {
    note = 'No teams in any division — set up Prelim first.'
    ready = false
  } else {
    const blocked = perDivision.filter((d) => d.issue !== null)
    if (blocked.length === 0) {
      note = 'Every division has a valid round-robin layout.'
      ready = true
    } else {
      note = blocked.map((d) => `Div ${d.division}: ${d.issue}`).join('. ') + '.'
      ready = false
    }
  }
  return { perDivision, ready, note }
})

/** Returns null if the division's prelim quizzes form a valid letter-
 *  level round-robin, or a one-line reason if not. The caller already
 *  knows the team count; we don't gate on `present === needed` first
 *  because the per-letter check naturally surfaces both shortfalls and
 *  shape problems. */
function checkPrelimRoundRobin(
  teamCount: number,
  prelims: { label: string; seats: { letter: string | null }[] }[],
): string | null {
  if (teamCount === 0) return 'no teams in division'
  if (prelims.length !== teamCount) {
    return prelims.length < teamCount
      ? `${teamCount - prelims.length} prelim ${teamCount - prelims.length === 1 ? 'quiz' : 'quizzes'} short`
      : `${prelims.length - teamCount} extra prelim ${prelims.length - teamCount === 1 ? 'quiz' : 'quizzes'}`
  }
  const expected = Array.from({ length: teamCount }, (_, i) => String.fromCharCode(65 + i))
  const expectedSet = new Set(expected)
  const occ: Record<string, number> = {}
  for (const l of expected) occ[l] = 0

  for (const q of prelims) {
    if (q.seats.length !== 3) return `${q.label} has ${q.seats.length} seats (need 3)`
    const inQuiz = new Set<string>()
    for (const seat of q.seats) {
      const letter = seat.letter
      if (!letter) return `${q.label} has an empty seat`
      if (!expectedSet.has(letter)) {
        return `${q.label} uses letter ${letter} (only A–${expected[expected.length - 1]} expected)`
      }
      if (inQuiz.has(letter)) return `${q.label} has duplicate ${letter}`
      inQuiz.add(letter)
      occ[letter] = (occ[letter] ?? 0) + 1
    }
  }

  for (const l of expected) {
    if (occ[l] !== 3) return `${l} appears ${occ[l]}× (need 3)`
  }

  // Pair distribution. Each quiz contributes 3 unordered pairs; for a
  // well-balanced round-robin every pair occurs roughly the same number
  // of times (max − min ≤ 1).
  const pair: Record<string, number> = {}
  for (const q of prelims) {
    const letters = q.seats.map((s) => s.letter!).sort()
    for (let i = 0; i < letters.length; i++) {
      for (let j = i + 1; j < letters.length; j++) {
        const key = `${letters[i]}|${letters[j]}`
        pair[key] = (pair[key] ?? 0) + 1
      }
    }
  }
  const counts = Object.values(pair)
  if (counts.length === 0) return null
  const totalPairs = (teamCount * (teamCount - 1)) / 2
  const usedPairs = counts.length
  // Pairs that never co-occur are min=0; account for them only if some
  // exist (otherwise the inferred minimum would be misleading).
  const min = usedPairs < totalPairs ? 0 : Math.min(...counts)
  const max = Math.max(...counts)
  if (max - min > 1) {
    return `pair distribution unbalanced (some meet ${max}×, others ${min}×)`
  }
  return null
}

/** Total quiz budget across all divisions. Threaded down so SkeletonSection
 *  can show capacity vs budget without recomputing. */
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

onMounted(async () => {
  await load()
  // Editing is admin-only; coaches/viewers fall back to the read-only
  // view at /:slug/schedule.
  if (!loading.value && !isAdmin.value) {
    router.replace({ name: 'meet-schedule', params: { slug: props.slug } })
  }
})
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'meet-schedule', params: { slug } })">
      ← View schedule
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet">
      <div class="page-header">
        <div class="meet-info">
          <h2 class="page-title">Edit schedule — {{ meet.name }}</h2>
          <span class="meet-meta">
            {{ meet.dateFrom }}{{ meet.dateTo ? ` – ${meet.dateTo}` : '' }} ·
            {{ divisions.length }} divisions
          </span>
        </div>
      </div>

      <nav class="tabs no-print" role="tablist" aria-label="Schedule sections">
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
        :editable="isAdmin"
      />

      <ElimSetupSection
        v-else-if="activeTab === 'elim'"
        :divisions="divisions"
        :team-counts="teamCounts"
        :extra-lanes="extraLanes"
        :editable="isAdmin"
        @toggle-lane="toggleLane"
        @resize-lane="resizeLane"
      />

      <SkeletonSection
        v-else-if="activeTab === 'skeleton'"
        :rooms="rooms"
        :slots="slots"
        :quiz-budget="quizBudget"
        :editable="isAdmin"
        @create-slot="onCreateSlot"
        @update-slot="onUpdateSlot"
        @delete-slot="onDeleteSlot"
      />

      <ReviewSection
        v-else-if="activeTab === 'draw'"
        :rooms="rooms"
        :slots="slots"
        :quizzes="quizzes"
        :divisions="divisions"
        :editable="isAdmin"
        :section-title="'Draw'"
        :can-populate="isAdmin"
        :populate-info="populateInfo"
        :roll-info="rollInfo"
        @update-slot="onUpdateSlot"
        @delete-quiz="onDeleteQuiz"
        @add-quiz="onAddQuiz"
        @update-quiz="onUpdateQuiz"
        @populate-skeleton="onPopulateSkeleton"
        @roll-teams="onRollTeams"
      />
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

.tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--color-border-alt);
  margin-bottom: 1.25rem;
  overflow-x: auto;
}

.tab {
  background: none;
  border: none;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.55rem 0.85rem;
  margin-bottom: -1px;
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
  border-bottom-color: var(--color-accent);
}
</style>
