<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const vFocus = { mounted: (el: HTMLElement) => el.focus() }

/**
 * v-fit-name="{ full, short }" — show full name if it fits, otherwise short name.
 * CSS text-overflow: ellipsis handles the final fallback.
 */
interface FitNameBinding {
  full: string
  short: string
}
function applyFitName(el: HTMLElement, { full, short }: FitNameBinding) {
  el.textContent = full
  requestAnimationFrame(() => {
    if (el.scrollWidth > el.clientWidth && short && short !== full) {
      el.textContent = short
    }
  })
}
const fitNameObservers = new WeakMap<HTMLElement, ResizeObserver>()
const fitNameValues = new WeakMap<HTMLElement, FitNameBinding>()
const vFitName = {
  mounted(el: HTMLElement, binding: { value: FitNameBinding }) {
    fitNameValues.set(el, binding.value)
    applyFitName(el, binding.value)
    const ro = new ResizeObserver(() => {
      const v = fitNameValues.get(el)
      if (v) applyFitName(el, v)
    })
    ro.observe(el)
    fitNameObservers.set(el, ro)
  },
  updated(el: HTMLElement, binding: { value: FitNameBinding }) {
    fitNameValues.set(el, binding.value)
    applyFitName(el, binding.value)
  },
  unmounted(el: HTMLElement) {
    fitNameObservers.get(el)?.disconnect()
    fitNameObservers.delete(el)
    fitNameValues.delete(el)
  },
}
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import {
  getMeet,
  getMyMeets,
  listChurches,
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  listQuizzers,
  addQuizzer,
  updateQuizzer,
  removeQuizzer,
  updateChurch,
  type QuizMeet,
  type Church,
  type Team,
  type Quizzer,
} from '../api'
import {
  coachChurchIds as deriveCoachChurchIds,
  isAdminOrSuperuser as deriveIsAdminOrSuperuser,
} from '../meetAccess'

const props = defineProps<{ slug: string; churchId: number }>()
const router = useRouter()
const { session } = useAuth()

// ---- State ----

const meet = ref<QuizMeet | null>(null)
const church = ref<Church | null>(null)

const teams = ref<Team[]>([])
const allQuizzers = ref<Quizzer[]>([])
// quizzerId → teamId (null = unassigned)
const assignments = ref<Record<number, number | null>>({})

const loading = ref(true)
const error = ref('')

const myCoachChurchIds = ref<Set<number>>(new Set())
const isSuperuserOrAdmin = ref(false)

const POOL_SENTINEL = Infinity

// Quizzer add
const addingQuizzerTeamId = ref<number | null>(null) // POOL_SENTINEL = unassigned pool
const newQuizzerName = ref('')
const addQuizzerError = ref('')

// Quizzer rename
const renamingQuizzerId = ref<number | null>(null)
const renameValue = ref('')

// Drag
const dragging = ref<{ quizzerId: number; fromTeamId: number | null } | null>(null)
// quizzerId to insert before (null = append to end of target)
const dragOverQuizzerId = ref<number | null>(null)
// teamId (or null for pool) being hovered — for card-level highlight
const dragOverContainer = ref<number | null | undefined>(undefined)

// Team reorder drag
const draggingTeamId = ref<number | null>(null)
const dragOverTeamId = ref<number | null>(null)
const dragOverTeamSide = ref<'before' | 'after' | null>(null)

// Ordered quizzer lists — keys are teamId or 'pool'
const quizzerOrder = ref<Record<string, number[]>>({})

// Draft: committed snapshot for diff-based save
interface Snapshot {
  teams: Team[]
  quizzers: Quizzer[]
  assignments: Record<number, number | null>
  quizzerOrder: Record<string, number[]>
}
const committed = ref<Snapshot>({ teams: [], quizzers: [], assignments: {}, quizzerOrder: {} })
const saving = ref(false)
const saveError = ref('')

// Church name editing
const editingChurchName = ref(false)
const churchNameForm = ref({ name: '', shortName: '' })
const savingChurchName = ref(false)

function startEditChurchName() {
  if (!church.value) return
  churchNameForm.value = {
    name: church.value.name,
    shortName: church.value.shortName === church.value.name ? '' : church.value.shortName,
  }
  editingChurchName.value = true
}

function cancelEditChurchName() {
  editingChurchName.value = false
}

async function saveChurchName() {
  if (!church.value) return
  const name = churchNameForm.value.name.trim()
  if (!name) return
  savingChurchName.value = true
  try {
    const data: { name: string; shortName?: string } = { name }
    const short = churchNameForm.value.shortName.trim()
    data.shortName = short || name
    const res = await updateChurch(church.value.id, data)
    church.value = res.church
    editingChurchName.value = false
  } catch (e) {
    alert((e as Error).message)
  } finally {
    savingChurchName.value = false
  }
}

function orderedQuizzersForTeam(teamId: number): Quizzer[] {
  const order = quizzerOrder.value[String(teamId)] ?? []
  return order
    .map((id) => allQuizzers.value.find((q) => q.quizzerId === id))
    .filter((q): q is Quizzer => q !== undefined)
}

function orderedUnassigned(): Quizzer[] {
  const order = quizzerOrder.value['pool'] ?? []
  return order
    .map((id) => allQuizzers.value.find((q) => q.quizzerId === id))
    .filter((q): q is Quizzer => q !== undefined)
}

function takeSnapshot() {
  committed.value = {
    teams: teams.value.map((t) => ({ ...t })),
    quizzers: allQuizzers.value.filter((q) => q.quizzerId > 0).map((q) => ({ ...q })),
    assignments: { ...assignments.value },
    quizzerOrder: Object.fromEntries(
      Object.entries(quizzerOrder.value).map(([k, v]) => [k, [...v]]),
    ),
  }
}

const isDirty = computed(() => {
  const snap = committed.value
  // Added or removed teams
  if (teams.value.some((t) => t.id < 0)) return true
  if (snap.teams.some((st) => !teams.value.find((t) => t.id === st.id))) return true
  // Team order changes
  if (teams.value.length === snap.teams.length) {
    for (let i = 0; i < teams.value.length; i++) {
      if (teams.value[i]!.id !== snap.teams[i]!.id) return true
    }
  }
  // Division changes on existing teams
  for (const t of teams.value) {
    if (t.id < 0) continue
    const orig = snap.teams.find((st) => st.id === t.id)
    if (orig && orig.division !== t.division) return true
  }
  // New quizzers (temp ids)
  if (allQuizzers.value.some((q) => q.quizzerId < 0)) return true
  // Removed quizzers
  if (snap.quizzers.some((sq) => !allQuizzers.value.find((q) => q.quizzerId === sq.quizzerId)))
    return true
  // Assignment or name changes
  for (const q of allQuizzers.value) {
    if (q.quizzerId < 0) continue
    if (assignments.value[q.quizzerId] !== snap.assignments[q.quizzerId]) return true
    const orig = snap.quizzers.find((sq) => sq.quizzerId === q.quizzerId)
    if (orig && orig.name !== q.name) return true
  }
  // Quizzer order within teams
  for (const [key, order] of Object.entries(quizzerOrder.value)) {
    const snapOrder = snap.quizzerOrder[key]
    if (!snapOrder) continue
    if (order.length !== snapOrder.length) continue
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== snapOrder[i]) return true
    }
  }
  return false
})

// ---- Derived ----

function canEdit(): boolean {
  if (!church.value) return false
  if (isSuperuserOrAdmin.value) return true
  return myCoachChurchIds.value.has(church.value.id)
}

const canEditChurch = computed(() => canEdit())

const unassigned = computed(() => orderedUnassigned())

function quizzersForTeam(teamId: number) {
  return orderedQuizzersForTeam(teamId)
}

// ---- Roster warnings ----

// Returns a warning string per team index (empty string = no warning).
// Rules checked:
//   1. Quizzer count outside 2–5
//   2. Division order — earlier teams should be in earlier-or-equal divisions
const teamWarnings = computed<string[]>(() => {
  const divs = meet.value?.divisions ?? []
  return teams.value.map((team, i) => {
    const msgs: string[] = []
    const count = quizzersForTeam(team.id).length
    if (count < 2) msgs.push(count === 0 ? 'No quizzers' : 'Fewer than 2 quizzers')
    if (count > 5) msgs.push('More than 5 quizzers')
    // Division order: this team's div index should be >= the previous team's
    const divIdx = divs.indexOf(team.division)
    if (i > 0) {
      const prevDivIdx = divs.indexOf(teams.value[i - 1]!.division)
      if (divIdx < prevDivIdx) msgs.push('Division is earlier than the team above')
    }
    // And <= the next team's
    if (i < teams.value.length - 1) {
      const nextDivIdx = divs.indexOf(teams.value[i + 1]!.division)
      if (divIdx > nextDivIdx) msgs.push('Division is later than the team below')
    }
    return msgs.join(' · ')
  })
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [meetRes, myMeetsRes] = await Promise.all([getMeet(props.slug), getMyMeets()])
    meet.value = meetRes.meet
    const id = meetRes.meet.id

    const membership = myMeetsRes.memberships.find((m) => m.meetId === id)
    if (!membership) {
      router.replace({ name: 'home' })
      return
    }

    const sessionUser = session.value?.data?.user
    const accountRole = (sessionUser as Record<string, unknown> | undefined)?.role as
      | string
      | undefined
    isSuperuserOrAdmin.value = deriveIsAdminOrSuperuser(myMeetsRes.memberships, id, accountRole)

    myCoachChurchIds.value = deriveCoachChurchIds(myMeetsRes.memberships, id)

    if (!isSuperuserOrAdmin.value && !myCoachChurchIds.value.has(props.churchId)) {
      router.replace({ name: 'meet', params: { slug: props.slug } })
      return
    }

    const churchRes = await listChurches(id)
    const found = churchRes.churches.find((c) => c.id === props.churchId)
    if (!found) {
      error.value = 'Church not found'
      return
    }
    church.value = found
    await loadChurchRoster(found.id)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function loadChurchRoster(churchId: number) {
  teams.value = []
  allQuizzers.value = []
  assignments.value = {}
  quizzerOrder.value = { pool: [] }
  saveError.value = ''

  const teamRes = await listTeams(churchId)
  teams.value = teamRes.teams.slice().sort((a, b) => a.number - b.number)
  for (const t of teams.value) quizzerOrder.value[String(t.id)] = []

  const rosterResults = await Promise.all(teams.value.map((t) => listQuizzers(t.id)))
  for (let i = 0; i < teams.value.length; i++) {
    const teamId = teams.value[i]!.id
    for (const q of rosterResults[i]!.quizzers) {
      allQuizzers.value.push(q)
      assignments.value[q.quizzerId] = teamId
      quizzerOrder.value[String(teamId)]!.push(q.quizzerId)
    }
  }
  takeSnapshot()
}

function startRename(quizzerId: number, name: string) {
  renamingQuizzerId.value = quizzerId
  renameValue.value = name
}

function startAddToPool() {
  addingQuizzerTeamId.value = POOL_SENTINEL
  newQuizzerName.value = ''
}

function startAddToTeam(teamId: number) {
  addingQuizzerTeamId.value = teamId
  newQuizzerName.value = ''
  addQuizzerError.value = ''
}

onMounted(load)

// ---- Team actions ----

let tempTeamId = -1

function startAddTeam() {
  const team: Team = {
    id: tempTeamId--,
    meetId: meet.value!.id,
    churchId: props.churchId,
    division: meet.value!.divisions[0] ?? '',
    number: 0, // placeholder; server assigns on save
  }
  teams.value.push(team)
  quizzerOrder.value[String(team.id)] = []
}

// Division change is purely local — saved on Save
function submitEditTeam(_teamId: number) {}

function handleRemoveTeam(teamId: number) {
  // Move any quizzers on this team back to the pool
  const order = quizzerOrder.value[String(teamId)] ?? []
  for (const qId of order) {
    assignments.value[qId] = null
    quizzerOrder.value['pool'] ??= []
    quizzerOrder.value['pool']!.push(qId)
  }
  delete quizzerOrder.value[String(teamId)]
  teams.value = teams.value.filter((t) => t.id !== teamId)
}

// ---- Quizzer actions (all local — saved as a batch via saveDraft) ----

let tempId = -1

function submitAddQuizzer(teamId: number) {
  if (!newQuizzerName.value.trim()) return
  const q: Quizzer = { quizzerId: tempId--, name: newQuizzerName.value.trim() }
  allQuizzers.value.push(q)
  assignments.value[q.quizzerId] = teamId
  quizzerOrder.value[String(teamId)] ??= []
  quizzerOrder.value[String(teamId)]!.push(q.quizzerId)
  newQuizzerName.value = ''
  addingQuizzerTeamId.value = null
}

function submitAddUnassigned() {
  if (!newQuizzerName.value.trim()) return
  const q: Quizzer = { quizzerId: tempId--, name: newQuizzerName.value.trim() }
  allQuizzers.value.push(q)
  assignments.value[q.quizzerId] = null
  quizzerOrder.value['pool'] ??= []
  quizzerOrder.value['pool']!.push(q.quizzerId)
  newQuizzerName.value = ''
  addingQuizzerTeamId.value = null
}

function submitRename(_teamId: number | null, quizzerId: number) {
  if (!renameValue.value.trim()) {
    renamingQuizzerId.value = null
    return
  }
  const q = allQuizzers.value.find((q) => q.quizzerId === quizzerId)
  if (q) q.name = renameValue.value.trim()
  renamingQuizzerId.value = null
}

function handleRemoveQuizzer(teamId: number | null, quizzerId: number) {
  const key = teamId === null ? 'pool' : String(teamId)
  allQuizzers.value = allQuizzers.value.filter((q) => q.quizzerId !== quizzerId)
  delete assignments.value[quizzerId]
  quizzerOrder.value[key] = (quizzerOrder.value[key] ?? []).filter((id) => id !== quizzerId)
}

// ---- Save draft ----

async function saveDraft() {
  saving.value = true
  saveError.value = ''
  try {
    const snap = committed.value

    // Deleted teams (existed before, gone now) — cascade removes their quizzers
    const removedTeams = snap.teams.filter((st) => !teams.value.find((t) => t.id === st.id))
    for (const st of removedTeams) {
      await deleteTeam(st.id)
    }

    // New teams (temp ids < 0)
    const newTeams = teams.value.filter((t) => t.id < 0)
    for (const t of newTeams) {
      const res = await createTeam(t.churchId, { division: t.division })
      const idx = teams.value.findIndex((x) => x.id === t.id)
      if (idx !== -1) teams.value[idx] = res.team
      // Patch quizzerOrder and assignments to use the real team id
      const oldKey = String(t.id)
      const newKey = String(res.team.id)
      quizzerOrder.value[newKey] = quizzerOrder.value[oldKey] ?? []
      delete quizzerOrder.value[oldKey]
      for (const [qId, tId] of Object.entries(assignments.value)) {
        if (tId === t.id) assignments.value[Number(qId)] = res.team.id
      }
    }

    // Division or order changes on existing teams
    for (let i = 0; i < teams.value.length; i++) {
      const t = teams.value[i]!
      if (t.id < 0) continue
      const orig = snap.teams.find((st) => st.id === t.id)
      const wantNumber = i + 1
      const patch: { division?: string; number?: number } = {}
      if (orig && orig.division !== t.division) patch.division = t.division
      if (t.number !== wantNumber) patch.number = wantNumber
      if (patch.division || patch.number) {
        const res = await updateTeam(t.id, patch)
        teams.value[i] = res.team
      }
    }

    // Removed quizzers (existed before, gone now — skip if their team was also deleted)
    const removedTeamIds = new Set(removedTeams.map((st) => st.id))
    const removedQuizzers = snap.quizzers.filter(
      (sq) => !allQuizzers.value.find((q) => q.quizzerId === sq.quizzerId),
    )
    for (const sq of removedQuizzers) {
      const prevTeamId = snap.assignments[sq.quizzerId] ?? null
      if (prevTeamId !== null && !removedTeamIds.has(prevTeamId)) {
        await removeQuizzer(prevTeamId, sq.quizzerId)
      }
    }

    // Existing quizzers — detect renames and assignment changes
    for (const q of allQuizzers.value) {
      if (q.quizzerId < 0) continue // new, handled below
      const origAssignment = snap.assignments[q.quizzerId] ?? null
      const newAssignment = assignments.value[q.quizzerId] ?? null
      const orig = snap.quizzers.find((sq) => sq.quizzerId === q.quizzerId)
      const nameChanged = orig && orig.name !== q.name

      if (origAssignment !== newAssignment) {
        // Move between team/pool — remove from old team, add to new
        if (origAssignment !== null && !removedTeamIds.has(origAssignment)) {
          await removeQuizzer(origAssignment, q.quizzerId)
        }
        if (newAssignment !== null) {
          const res = await addQuizzer(newAssignment, q.name)
          const idx = allQuizzers.value.findIndex((x) => x.quizzerId === q.quizzerId)
          if (idx !== -1) allQuizzers.value[idx] = res.quizzer
          const toKey = String(newAssignment)
          quizzerOrder.value[toKey] = (quizzerOrder.value[toKey] ?? []).map((id) =>
            id === q.quizzerId ? res.quizzer.quizzerId : id,
          )
          assignments.value[res.quizzer.quizzerId] = newAssignment
          delete assignments.value[q.quizzerId]
        }
      } else if (nameChanged && newAssignment !== null) {
        await updateQuizzer(newAssignment, q.quizzerId, q.name)
      }
    }

    // New quizzers (temp ids < 0)
    const newOnes = allQuizzers.value.filter((q) => q.quizzerId < 0)
    for (const q of newOnes) {
      const teamId = assignments.value[q.quizzerId] ?? null
      if (teamId !== null) {
        const res = await addQuizzer(teamId, q.name)
        const idx = allQuizzers.value.findIndex((x) => x.quizzerId === q.quizzerId)
        if (idx !== -1) allQuizzers.value[idx] = res.quizzer
        const toKey = String(teamId)
        quizzerOrder.value[toKey] = (quizzerOrder.value[toKey] ?? []).map((id) =>
          id === q.quizzerId ? res.quizzer.quizzerId : id,
        )
        assignments.value[res.quizzer.quizzerId] = teamId
        delete assignments.value[q.quizzerId]
      }
      // new unassigned quizzers: no API backing yet; just drop them silently
      // (the pool has no team to persist to)
    }
    // Drop any lingering temp-id unassigned entries
    allQuizzers.value = allQuizzers.value.filter((q) => q.quizzerId > 0)
    quizzerOrder.value['pool'] = (quizzerOrder.value['pool'] ?? []).filter((id) => id > 0)

    takeSnapshot()
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

function discardDraft() {
  if (!confirm('Discard all unsaved changes?')) return
  const snap = committed.value
  teams.value = snap.teams.map((t) => ({ ...t }))
  allQuizzers.value = snap.quizzers.map((q) => ({ ...q }))
  assignments.value = { ...snap.assignments }
  quizzerOrder.value = Object.fromEntries(
    Object.entries(snap.quizzerOrder).map(([k, v]) => [k, [...v]]),
  )
  saveError.value = ''
}

// ---- Drag & drop ----

function onDragStart(quizzerId: number, fromTeamId: number | null) {
  dragging.value = { quizzerId, fromTeamId }
}

function onDragEnd() {
  dragging.value = null
  dragOverQuizzerId.value = null
  dragOverContainer.value = undefined
}

function onDragOverContainer(containerId: number | null) {
  if (draggingTeamId.value !== null) return
  dragOverContainer.value = containerId
}

function onDragLeaveContainer() {
  // only clear if not hovering a child quizzer slot
  dragOverContainer.value = undefined
}

function onDragOverQuizzer(quizzerId: number, containerId: number | null) {
  if (draggingTeamId.value !== null) return
  dragOverContainer.value = containerId
  dragOverQuizzerId.value = quizzerId
}

function onDragLeaveQuizzer() {
  dragOverQuizzerId.value = null
}

// Move quizzerId within/between order lists, inserting before beforeId (null = append)
function reorderLocally(
  quizzerId: number,
  fromKey: string,
  toKey: string,
  beforeId: number | null,
) {
  const from = quizzerOrder.value[fromKey] ?? []
  quizzerOrder.value[fromKey] = from.filter((id) => id !== quizzerId)
  const to = (quizzerOrder.value[toKey] ?? []).filter((id) => id !== quizzerId)
  if (beforeId === null) {
    to.push(quizzerId)
  } else {
    const pos = to.indexOf(beforeId)
    to.splice(pos === -1 ? to.length : pos, 0, quizzerId)
  }
  quizzerOrder.value[toKey] = to
}

function onDrop(toTeamId: number | null) {
  if (!dragging.value) return
  const { quizzerId, fromTeamId } = dragging.value
  const insertBefore = dragOverQuizzerId.value
  dragging.value = null
  dragOverQuizzerId.value = null
  dragOverContainer.value = undefined

  const fromKey = fromTeamId === null ? 'pool' : String(fromTeamId)
  const toKey = toTeamId === null ? 'pool' : String(toTeamId)

  // Same container — pure reorder, no API call needed
  if (toTeamId === fromTeamId) {
    if (insertBefore !== quizzerId) {
      reorderLocally(quizzerId, fromKey, toKey, insertBefore)
    }
    return
  }

  // Moving between containers — local only, saved on Save
  assignments.value[quizzerId] = toTeamId
  reorderLocally(quizzerId, fromKey, toKey, insertBefore)
}

// ---- Team reorder drag ----

function onTeamDragStart(teamId: number) {
  draggingTeamId.value = teamId
}

function onTeamDragEnd() {
  draggingTeamId.value = null
  dragOverTeamId.value = null
  dragOverTeamSide.value = null
}

function onTeamDragOver(teamId: number, event: DragEvent) {
  if (draggingTeamId.value === null || draggingTeamId.value === teamId) return
  dragOverTeamId.value = teamId
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  dragOverTeamSide.value = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
}

function onTeamDragLeave() {
  dragOverTeamId.value = null
  dragOverTeamSide.value = null
}

function onTeamDrop(toTeamId: number) {
  const fromId = draggingTeamId.value
  const side = dragOverTeamSide.value
  draggingTeamId.value = null
  dragOverTeamId.value = null
  dragOverTeamSide.value = null
  if (fromId === null || fromId === toTeamId) return
  const fromIdx = teams.value.findIndex((t) => t.id === fromId)
  if (fromIdx === -1) return
  const moved = teams.value.splice(fromIdx, 1)[0]!
  const targetIdx = teams.value.findIndex((t) => t.id === toTeamId)
  if (targetIdx === -1) return
  teams.value.splice(side === 'after' ? targetIdx + 1 : targetIdx, 0, moved)
}
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
        <template v-if="editingChurchName">
          <form class="church-name-edit" @submit.prevent="saveChurchName">
            <input
              v-model="churchNameForm.name"
              v-focus
              class="church-name-input"
              placeholder="Full name"
              required
            />
            <input
              v-model="churchNameForm.shortName"
              class="church-name-input church-name-input--short"
              placeholder="Short (optional)"
            />
            <button type="submit" class="btn btn--primary btn--sm" :disabled="savingChurchName">
              {{ savingChurchName ? '…' : 'Save' }}
            </button>
            <button type="button" class="btn btn--ghost btn--sm" @click="cancelEditChurchName">
              Cancel
            </button>
          </form>
        </template>
        <template v-else>
          <h2 class="page-title">
            {{ church?.name }}
            <span v-if="church && church.shortName !== church.name" class="page-title-short">
              ({{ church.shortName }})
            </span>
            <button
              v-if="canEditChurch"
              class="church-name-pencil"
              title="Edit church name"
              @click="startEditChurchName"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </h2>
          <span class="meet-name">Teams &amp; Rosters</span>
        </template>
      </div>

      <!-- Draft save bar -->
      <div v-if="canEditChurch && isDirty" class="draft-bar">
        <span class="draft-bar-label">Unsaved changes</span>
        <p v-if="saveError" class="draft-bar-error">{{ saveError }}</p>
        <div class="draft-bar-actions">
          <button class="btn btn--ghost btn--sm" :disabled="saving" @click="discardDraft">
            Discard
          </button>
          <button class="btn btn--primary btn--sm" :disabled="saving" @click="saveDraft">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>

      <div class="teams-grid">
        <!-- Unassigned pool -->
        <div
          class="team-card team-card--pool"
          :class="{ 'team-card--dragover': dragOverContainer === null && dragging !== null }"
          @dragover.prevent="onDragOverContainer(null)"
          @dragleave="onDragLeaveContainer"
          @drop.prevent="onDrop(null)"
        >
          <div class="team-card-header">
            <span class="team-label">Unassigned</span>
          </div>

          <ul class="quizzer-list">
            <li
              v-for="q in unassigned"
              :key="q.quizzerId"
              class="quizzer-chip"
              :class="{
                'quizzer-chip--insert-before':
                  draggingTeamId === null && dragOverQuizzerId === q.quizzerId,
              }"
              :draggable="canEditChurch && renamingQuizzerId !== q.quizzerId"
              @dragstart="
                canEditChurch && renamingQuizzerId !== q.quizzerId && onDragStart(q.quizzerId, null)
              "
              @dragover.prevent="onDragOverQuizzer(q.quizzerId, null)"
              @dragleave.stop="onDragLeaveQuizzer"
              @dragend="onDragEnd"
            >
              <template v-if="renamingQuizzerId === q.quizzerId">
                <input
                  v-model="renameValue"
                  v-focus
                  class="rename-input"
                  @keyup.enter="submitRename(null, q.quizzerId)"
                  @keyup.escape="renamingQuizzerId = null"
                  @blur="submitRename(null, q.quizzerId)"
                />
              </template>
              <template v-else>
                <span
                  class="quizzer-name"
                  @dblclick="canEditChurch && startRename(q.quizzerId, q.name)"
                  >{{ q.name }}</span
                >
                <button
                  v-if="canEditChurch"
                  class="quizzer-pencil"
                  title="Rename"
                  @click.stop="startRename(q.quizzerId, q.name)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  v-if="canEditChurch"
                  class="quizzer-remove"
                  title="Remove"
                  @click.stop="handleRemoveQuizzer(null, q.quizzerId)"
                >
                  ×
                </button>
              </template>
            </li>
          </ul>
          <div
            v-if="dragging"
            class="drop-tail"
            :class="{
              'drop-tail--active': dragOverContainer === null && dragOverQuizzerId === null,
            }"
            @dragover.prevent="onDragOverContainer(null)"
            @dragleave="onDragLeaveContainer"
          ></div>

          <template v-if="canEditChurch">
            <form
              v-if="addingQuizzerTeamId === POOL_SENTINEL"
              class="inline-add"
              @submit.prevent="submitAddUnassigned"
            >
              <input
                v-model="newQuizzerName"
                v-focus
                class="inline-add-input"
                placeholder="Name"
                @keyup.escape="addingQuizzerTeamId = null"
              />
              <div class="inline-add-actions">
                <button type="submit" class="btn btn--primary btn--sm">Add</button>
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  @click="addingQuizzerTeamId = null"
                >
                  Cancel
                </button>
              </div>
            </form>
            <button
              v-else-if="addingQuizzerTeamId === null"
              class="dashed-add"
              @click="startAddToPool()"
            >
              + Quizzer
            </button>
          </template>
        </div>

        <!-- Teams -->
        <div
          v-for="(team, teamIdx) in teams"
          :key="team.id"
          class="team-card"
          :class="{
            'team-card--dragover': dragOverContainer === team.id && draggingTeamId === null,
            'team-card--warn': !!teamWarnings[teamIdx],
            'team-card--team-insert-before':
              draggingTeamId !== null &&
              dragOverTeamId === team.id &&
              dragOverTeamSide === 'before',
            'team-card--team-insert-after':
              draggingTeamId !== null && dragOverTeamId === team.id && dragOverTeamSide === 'after',
          }"
          @dragover.prevent="
            draggingTeamId !== null ? onTeamDragOver(team.id, $event) : onDragOverContainer(team.id)
          "
          @dragleave="draggingTeamId !== null ? onTeamDragLeave() : onDragLeaveContainer()"
          @drop.prevent="draggingTeamId !== null ? onTeamDrop(team.id) : onDrop(team.id)"
        >
          <div class="team-card-header">
            <span
              v-if="canEditChurch"
              class="team-drag-handle"
              draggable="true"
              title="Drag to reorder"
              @dragstart.stop="onTeamDragStart(team.id)"
              @dragend.stop="onTeamDragEnd"
              >⠿</span
            >
            <span class="team-label">
              <span
                v-fit-name="{ full: church?.name ?? '?', short: church?.shortName ?? '?' }"
                class="team-label-name"
              ></span>
              <span class="team-label-number">{{ teams.indexOf(team) + 1 }}</span>
            </span>
            <span class="div-label">Div</span>
            <select
              v-model="team.division"
              class="division-select"
              :disabled="!canEditChurch"
              @change="submitEditTeam(team.id)"
            >
              <option v-for="div in meet.divisions" :key="div" :value="div">{{ div }}</option>
            </select>
            <span class="team-count">{{ quizzersForTeam(team.id).length }}</span>
            <button
              v-if="canEditChurch"
              class="team-remove"
              title="Remove team"
              @click="handleRemoveTeam(team.id)"
            >
              ×
            </button>
          </div>

          <p v-if="teamWarnings[teamIdx]" class="team-warn">⚠ {{ teamWarnings[teamIdx] }}</p>

          <ul class="quizzer-list">
            <li
              v-for="q in quizzersForTeam(team.id)"
              :key="q.quizzerId"
              class="quizzer-chip"
              :class="{
                'quizzer-chip--insert-before':
                  draggingTeamId === null && dragOverQuizzerId === q.quizzerId,
              }"
              :draggable="canEditChurch && renamingQuizzerId !== q.quizzerId"
              @dragstart="
                canEditChurch &&
                renamingQuizzerId !== q.quizzerId &&
                onDragStart(q.quizzerId, team.id)
              "
              @dragover.prevent="onDragOverQuizzer(q.quizzerId, team.id)"
              @dragleave.stop="onDragLeaveQuizzer"
              @dragend="onDragEnd"
            >
              <template v-if="renamingQuizzerId === q.quizzerId">
                <input
                  v-model="renameValue"
                  v-focus
                  class="rename-input"
                  @keyup.enter="submitRename(team.id, q.quizzerId)"
                  @keyup.escape="renamingQuizzerId = null"
                  @blur="submitRename(team.id, q.quizzerId)"
                />
              </template>
              <template v-else>
                <span
                  class="quizzer-name"
                  @dblclick="canEditChurch && startRename(q.quizzerId, q.name)"
                  >{{ q.name }}</span
                >
                <button
                  v-if="canEditChurch"
                  class="quizzer-pencil"
                  title="Rename"
                  @click.stop="startRename(q.quizzerId, q.name)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  v-if="canEditChurch"
                  class="quizzer-remove"
                  title="Remove"
                  @click.stop="handleRemoveQuizzer(team.id, q.quizzerId)"
                >
                  ×
                </button>
              </template>
            </li>
          </ul>
          <div
            v-if="dragging"
            class="drop-tail"
            :class="{
              'drop-tail--active': dragOverContainer === team.id && dragOverQuizzerId === null,
            }"
            @dragover.prevent="onDragOverContainer(team.id)"
            @dragleave="onDragLeaveContainer"
          ></div>

          <template v-if="canEditChurch">
            <form
              v-if="addingQuizzerTeamId === team.id"
              class="inline-add"
              @submit.prevent="submitAddQuizzer(team.id)"
            >
              <input
                v-model="newQuizzerName"
                v-focus
                class="inline-add-input"
                placeholder="Name"
                @keyup.escape="addingQuizzerTeamId = null"
              />
              <div class="inline-add-actions">
                <button type="submit" class="btn btn--primary btn--sm">Add</button>
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  @click="addingQuizzerTeamId = null"
                >
                  Cancel
                </button>
              </div>
              <p v-if="addQuizzerError" class="field-error">{{ addQuizzerError }}</p>
            </form>
            <button
              v-else-if="addingQuizzerTeamId === null && quizzersForTeam(team.id).length < 5"
              class="dashed-add"
              @click="startAddToTeam(team.id)"
            >
              + Quizzer
            </button>
          </template>
        </div>

        <!-- + Team card -->
        <div v-if="canEditChurch" class="team-card team-card--add">
          <button class="dashed-add dashed-add--fill" @click="startAddTeam">+ Team</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.container {
  max-width: 72rem;
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

.page-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-heading);
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.page-title-short {
  font-weight: 400;
  font-size: 0.85rem;
  color: var(--color-text-faint);
}

.church-name-pencil {
  background: none;
  border: none;
  padding: 0.15rem 0.25rem;
  color: var(--color-text-faint);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.1s;
}

.page-title:hover .church-name-pencil {
  opacity: 1;
}

.church-name-pencil:hover {
  color: var(--color-accent);
  background: var(--color-bg-raised);
}

.church-name-edit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.church-name-input {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.35rem 0.6rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text);
  font-family: inherit;
  outline: none;
  min-width: 0;
}

.church-name-input:focus {
  border-color: var(--color-accent);
}

.church-name-input--short {
  max-width: 7rem;
  font-size: 0.85rem;
  font-weight: 400;
}

.meet-name {
  font-size: 0.8rem;
  color: var(--color-text-faint);
}

.state-msg {
  font-size: 0.875rem;
  color: var(--color-text-faint);
}
.state-msg--error {
  color: var(--palette-error);
}

.teams-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.875rem;
  align-items: start;
}

.team-card {
  position: relative;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  transition: border-color 0.1s;
}

.team-card--team-insert-before::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(-0.4375rem - 1.5px); /* half the grid gap + half the line */
  width: 3px;
  background: var(--color-accent);
  border-radius: 1.5px;
  pointer-events: none;
}

.team-card--team-insert-after::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: calc(-0.4375rem - 1.5px);
  width: 3px;
  background: var(--color-accent);
  border-radius: 1.5px;
  pointer-events: none;
}

.team-drag-handle {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  cursor: grab;
  padding: 0 0.15rem;
  flex-shrink: 0;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.1s;
}

.team-card:hover .team-drag-handle {
  opacity: 1;
}

.team-drag-handle:active {
  cursor: grabbing;
}

.team-card--dragover {
  border-color: var(--color-accent);
  background: var(--color-bg);
}

.team-card--warn {
  border-color: var(--palette-warning, #b45309);
}

.team-warn {
  font-size: 0.7rem;
  color: var(--palette-warning, #b45309);
  margin-bottom: 0.25rem;
  line-height: 1.4;
}

.team-card--pool {
  border-style: dashed;
}

.team-card--add {
  background: transparent;
  border-style: dashed;
  align-items: stretch;
  justify-content: stretch;
}

.team-card-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
  min-width: 0;
}

.team-count {
  font-size: 0.7rem;
  color: var(--color-text-faint);
  background: var(--color-bg);
  border-radius: 999px;
  padding: 0 0.4rem;
  flex-shrink: 0;
  margin-left: auto;
}

.team-remove {
  background: none;
  border: none;
  font-size: 0.9rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0 0.1rem;
  font-family: inherit;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.1s;
}

.team-card:hover .team-remove {
  opacity: 1;
}

.team-remove:hover {
  color: var(--palette-error);
}

.team-label {
  display: flex;
  gap: 0.25rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-heading);
  min-width: 0;
  overflow: hidden;
}

.team-label-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.team-label-number {
  flex-shrink: 0;
}

.div-label {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  flex-shrink: 0;
}

.division-select {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border);
  border-radius: 0;
  padding: 0 0.1rem;
  font-size: 0.75rem;
  font-family: inherit;
  color: var(--color-text-muted);
  outline: none;
  cursor: pointer;
  max-width: 5rem;
}

.division-select:disabled {
  cursor: default;
  opacity: 1;
  -webkit-appearance: none;
  appearance: none;
}

.quizzer-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-height: 9.25rem; /* ~5 quizzer chips */
}

.quizzer-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
  user-select: none;
  cursor: grab;
}

.quizzer-chip:active {
  cursor: grabbing;
}

.quizzer-chip--insert-before::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: calc(-0.125rem - 1.5px); /* half the list gap + half the line */
  height: 2px;
  background: var(--color-accent);
  border-radius: 1px;
  pointer-events: none;
}

.drop-tail {
  height: 0;
  position: relative;
  transition: height 0.1s;
}

.drop-tail--active {
  height: 0.5rem;
}

.drop-tail--active::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: calc(50% - 1px);
  height: 2px;
  background: var(--color-accent);
  border-radius: 1px;
  pointer-events: none;
}

.quizzer-name {
  flex: 1;
}

.quizzer-pencil {
  background: none;
  border: none;
  padding: 0 0.1rem;
  color: var(--color-text-faint);
  cursor: pointer;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.1s;
}

.quizzer-chip:hover .quizzer-pencil {
  opacity: 1;
}

.quizzer-pencil:hover {
  color: var(--color-accent);
}

.quizzer-remove {
  background: none;
  border: none;
  font-size: 0.9rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0 0.1rem;
  font-family: inherit;
  opacity: 0;
  transition: opacity 0.1s;
}

.quizzer-chip:hover .quizzer-remove {
  opacity: 1;
}

.quizzer-remove:hover {
  color: var(--palette-error);
}

.rename-input {
  flex: 1;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-accent);
  outline: none;
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--color-text);
  padding: 0;
  width: 100%;
}

.dashed-add {
  width: 100%;
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 4px;
  padding: 0.3rem;
  font-size: 0.75rem;
  color: var(--color-text-faint);
  cursor: pointer;
  font-family: inherit;
  text-align: center;
  margin-top: 0.25rem;
  transition:
    border-color 0.15s,
    color 0.15s;
}

.dashed-add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.dashed-add--fill {
  flex: 1;
  height: 100%;
  margin-top: 0;
  min-height: 5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.inline-add {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.25rem;
}

.inline-add-input {
  background: var(--color-bg);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--color-text);
  outline: none;
  width: 100%;
}

.inline-add-actions {
  display: flex;
  gap: 0.35rem;
}

.warn-msg {
  font-size: 0.75rem;
  color: var(--palette-warning, #b45309);
  line-height: 1.4;
}

.field-error {
  font-size: 0.75rem;
  color: var(--palette-error);
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.85rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}

.btn--sm {
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
}

.btn--primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: var(--color-accent);
}
.btn--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border-color: var(--color-border);
}
.btn--secondary:hover:not(:disabled) {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.btn--ghost {
  background: transparent;
  color: var(--color-text-faint);
  border-color: transparent;
}
.btn--ghost:hover:not(:disabled) {
  color: var(--color-text-muted);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
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
