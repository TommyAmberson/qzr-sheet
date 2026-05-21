<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

import type { SeatInput } from '../api'
import { estimateLaneQuizzes } from '../brackets'
import ElimSetupSection from '../components/schedule/ElimSetupSection.vue'
import PrelimSetupSection from '../components/schedule/PrelimSetupSection.vue'
import ReviewSection from '../components/schedule/ReviewSection.vue'
import SkeletonSection from '../components/schedule/SkeletonSection.vue'
import { useScheduleData } from '../composables/useScheduleData'
import { getPrelimDraw } from '../prelimDraw'
import { allocateCells } from '../scheduleAlloc'
import { arrangeAllDivisions, type DivisionPlacementInput } from '../scheduleArrange'
import { buildElimPlan, type QuizDef } from '../scheduleBuild'
import { bySortOrder, isStatsBreak } from '../scheduleGrid'
import type { Row } from '../scheduleSort'

const props = defineProps<{ slug: string }>()
const router = useRouter()
const route = useRoute()

const {
  rooms,
  slots,
  quizzes,
  teamCounts,
  teams,
  prelimAssignments,
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
  replaceQuizzes,
  updateTeamLateness,
  rollTeams,
  isDirty,
  saving,
  saveError,
  saveDraft,
  discardDraft,
} = useScheduleData(toRef(props, 'slug'))

function onCreateSlot(payload: {
  startAt: string
  durationMinutes: number
  kind: 'quiz' | 'event'
  eventLabel: string | null
  sortOrder: number
}) {
  createSlot(payload)
}

function onUpdateSlot(payload: {
  slotId: number
  patch: {
    startAt?: string
    durationMinutes?: number
    eventLabel?: string | null
    sortOrder?: number
  }
}) {
  updateSlot(payload.slotId, payload.patch)
}

function onDeleteSlot(slotId: number) {
  deleteSlot(slotId)
}

function onDeleteQuiz(quizId: number) {
  deleteQuiz(quizId)
}

function onAddQuiz(payload: {
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  seats: SeatInput[]
}) {
  createQuiz(payload)
}

function onUpdateQuiz(payload: { quizId: number; patch: { label?: string }; seats: SeatInput[] }) {
  updateQuiz(payload.quizId, payload.patch, payload.seats)
}

function onUpdateTeamLateness(payload: { teamId: number; lateness: boolean }) {
  updateTeamLateness(payload.teamId, payload.lateness)
}

/** Per-division elim quiz count from team count + extra-lane drafts.
 *  Main bracket size = team count minus teams pulled into extra lanes;
 *  each lane's quiz count comes from `estimateLaneQuizzes`. */
function elimCountFor(division: string): number {
  const teamCount = teamCounts.value[division] ?? 0
  const extras = extraLanes.value[division] ?? []
  const usedByExtras = extras.reduce((sum, l) => sum + l.teamCount, 0)
  const mainSize = Math.max(0, teamCount - usedByExtras)
  return (
    estimateLaneQuizzes(mainSize) +
    extras.reduce((sum, l) => sum + estimateLaneQuizzes(l.teamCount), 0)
  )
}

/** Late letters for a division: letters mapped by `prelim_assignments`
 *  to teams whose `lateness` flag is set. Empty set when Roll Teams
 *  hasn't run yet or no teams are late. */
function lateLettersFor(division: string): Set<string> {
  const lateTeamIds = new Set(
    teams.value.filter((t) => t.lateness && t.division === division).map((t) => t.id),
  )
  const lateLetters = new Set<string>()
  if (lateTeamIds.size === 0) return lateLetters
  for (const a of prelimAssignments.value) {
    if (a.division === division && lateTeamIds.has(a.teamId)) lateLetters.add(a.letter)
  }
  return lateLetters
}

/** Wipe and recreate all prelim + elim quizzes from the current
 *  rule-book + skeleton state — purely on the local draft, no network.
 *  Save commits the new layout. When `applyLateness` is true, the
 *  prelim rule-book rows for each division are sorted so K-tuples
 *  containing late letters land at the high cell indices; otherwise
 *  rule-book order is preserved. */
function runPopulate(applyLateness: boolean) {
  const sorted = [...slots.value].sort(bySortOrder)
  const breakIdx = sorted.findIndex(isStatsBreak)
  if (breakIdx === -1) {
    alert('Add a Stats break in Skeleton — Populate uses it as the prelim/elim divider.')
    return
  }
  const prelimSlots = sorted.slice(0, breakIdx).filter((s) => s.kind === 'quiz')
  const elimSlots = sorted.slice(breakIdx + 1).filter((s) => s.kind === 'quiz')
  if ((prelimSlots.length === 0 && elimSlots.length === 0) || rooms.value.length === 0) {
    alert('Add slots in Skeleton and rooms to the meet before populating.')
    return
  }

  const elimCounts: Record<string, number> = {}
  for (const div of divisions.value) elimCounts[div] = elimCountFor(div)

  // Build the prelim placement input for every division (rule-book
  // rows + lateness mask). Divisions with no rule-book pattern fall
  // back to placeholder A/B/C seats.
  const unsupported: number[] = []
  const prelimInputs: DivisionPlacementInput[] = []
  for (const div of divisions.value) {
    const teamCount = teamCounts.value[div] ?? 0
    const draw = getPrelimDraw(teamCount)
    if (teamCount > 0 && draw === null) unsupported.push(teamCount)
    const rows: Row[] = draw
      ? draw.map((r) => [r[0], r[1], r[2]] as Row)
      : Array.from({ length: teamCount }, () => ['A', 'B', 'C'] as Row)
    prelimInputs.push({
      division: div,
      teamCount,
      rows,
      lateLetters: applyLateness ? lateLettersFor(div) : new Set<string>(),
    })
  }

  // Prelims: combined alloc + place. Elims: simpler allocateCells
  // since elim seats are placeholder.
  const prelimArrangement = arrangeAllDivisions(prelimInputs, prelimSlots, rooms.value)
  const elimAlloc = allocateCells(divisions.value, elimCounts, elimSlots, rooms.value)

  if (prelimArrangement.shortfall > 0 || elimAlloc.shortfall > 0) {
    const parts: string[] = []
    if (prelimArrangement.shortfall > 0) parts.push(`${prelimArrangement.shortfall} prelim`)
    if (elimAlloc.shortfall > 0) parts.push(`${elimAlloc.shortfall} elim`)
    const ok = confirm(`Plan exceeds capacity (${parts.join(', ')} cells short). Truncate to fit?`)
    if (!ok) return
  }

  const plan: QuizDef[] = []
  for (const div of divisions.value) {
    plan.push(...(prelimArrangement.perDivision.get(div) ?? []))
    plan.push(...buildElimPlan(div, elimAlloc.perDivision.get(div) ?? []))
  }

  replaceQuizzes(plan)

  if (unsupported.length > 0) {
    console.warn(
      `Populate: no rule-book draw pattern for team counts ${unsupported.join(', ')}; ` +
        'falling back to placeholder A/B/C seats. Edit those quizzes manually or add the pattern to prelimDraw.ts.',
    )
  }
}

function onPopulateSkeleton() {
  runPopulate(false)
}

function onSortByLateness() {
  runPopulate(true)
}

function onRollTeams() {
  for (const div of divisions.value) {
    rollTeams(div)
  }
}

// ---- Save / Discard ----

async function onSave() {
  try {
    await saveDraft()
  } catch {
    // saveError surfaces the message in the bar
  }
}

function onDiscard() {
  discardDraft()
}

// Browser-level guard: pageload-style navigation away while dirty
// prompts the native "Leave site? Changes you made may not be saved."
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty.value) {
    e.preventDefault()
    // Required by some browsers; the actual string is ignored.
    e.returnValue = ''
  }
}

// Vue Router navigation guard for in-app route changes.
onBeforeRouteLeave(() => {
  if (!isDirty.value) return true
  return confirm('You have unsaved schedule changes. Leave anyway?')
})

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
  let prelimNeeded = 0
  let elimNeeded = 0
  for (const div of divisions.value) {
    prelimNeeded += teamCounts.value[div] ?? 0
    elimNeeded += elimCountFor(div)
  }
  const needed = prelimNeeded + elimNeeded

  const sorted = [...slots.value].sort(bySortOrder)
  const breakIdx = sorted.findIndex(isStatsBreak)
  const prelimSlots =
    breakIdx === -1 ? [] : sorted.slice(0, breakIdx).filter((s) => s.kind === 'quiz')
  const elimSlots =
    breakIdx === -1 ? [] : sorted.slice(breakIdx + 1).filter((s) => s.kind === 'quiz')
  const prelimCapacity = prelimSlots.length * rooms.value.length
  const elimCapacity = elimSlots.length * rooms.value.length
  const capacity = prelimCapacity + elimCapacity

  let note: string
  let ready: boolean
  if (divisions.value.length === 0) {
    note = 'No divisions yet. Add team rosters in Churches first.'
    ready = false
  } else if (needed === 0) {
    note = 'Set team counts in Prelim setup and lane sizes in Elim setup.'
    ready = false
  } else if (rooms.value.length === 0) {
    note = 'Add rooms to the meet on the dashboard.'
    ready = false
  } else if (breakIdx === -1) {
    note = 'No stats break in Skeleton. Add one to mark where prelims end and elims begin.'
    ready = false
  } else if (prelimCapacity < prelimNeeded || elimCapacity < elimNeeded) {
    const issues: string[] = []
    if (prelimCapacity < prelimNeeded) {
      issues.push(`${prelimNeeded - prelimCapacity} prelim cells short before stats break`)
    }
    if (elimCapacity < elimNeeded) {
      issues.push(`${elimNeeded - elimCapacity} elim cells short after stats break`)
    }
    note = `${issues.join(', ')} — add slots or move the stats break.`
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
  window.addEventListener('beforeunload', onBeforeUnload)
  await load()
  // Editing is admin-only; coaches/viewers fall back to the read-only
  // view at /:slug/schedule.
  if (!loading.value && !isAdmin.value) {
    router.replace({ name: 'meet-schedule', params: { slug: props.slug } })
  }
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
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

      <div v-if="isAdmin && isDirty" class="draft-bar">
        <span class="draft-bar-label">Unsaved schedule changes</span>
        <p v-if="saveError" class="draft-bar-error">{{ saveError }}</p>
        <div class="draft-bar-actions">
          <button class="btn btn--ghost btn--sm" :disabled="saving" @click="onDiscard">
            Discard
          </button>
          <button class="btn btn--primary btn--sm" :disabled="saving" @click="onSave">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
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
        :teams="teams"
        :editable="isAdmin"
        :slug="slug"
        @update-team-lateness="onUpdateTeamLateness"
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
        :prelim-assignments="prelimAssignments"
        :meet-teams="teams"
        @update-slot="onUpdateSlot"
        @delete-quiz="onDeleteQuiz"
        @add-quiz="onAddQuiz"
        @update-quiz="onUpdateQuiz"
        @populate-skeleton="onPopulateSkeleton"
        @roll-teams="onRollTeams"
        @sort-by-lateness="onSortByLateness"
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

.draft-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
}

.draft-bar-label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  flex: 1;
}

.draft-bar-error {
  font-size: 0.75rem;
  color: var(--palette-error);
}

.draft-bar-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}
</style>
