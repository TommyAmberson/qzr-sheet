<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import {
  getMeet,
  getMyMeets,
  listChurches,
  createChurch,
  listTeams,
  createTeam,
  updateTeam,
  listQuizzers,
  addQuizzer,
  updateQuizzer,
  removeQuizzer,
  type QuizMeet,
  type Church,
  type Team,
  type Quizzer,
} from '../api'

const props = defineProps<{ id: number }>()
const router = useRouter()
const { session } = useAuth()

// ---- State ----

const meet = ref<QuizMeet | null>(null)
const churches = ref<Church[]>([])
const selectedChurchId = ref<number | null>(null)
const myUserId = ref<string | null>(null)
const isSuperuser = ref(false)

const teams = ref<Team[]>([])
const allQuizzers = ref<Quizzer[]>([])
// quizzerId → teamId (null = unassigned)
const assignments = ref<Record<number, number | null>>({})

const loading = ref(true)
const error = ref('')

// Church create
const showCreateChurch = ref(false)
const churchForm = ref({ name: '', shortName: '' })
const creatingChurch = ref(false)
const createChurchError = ref('')

// Team create — dashed card mode
const addingTeam = ref(false)
const newTeamDivision = ref('')
const createTeamError = ref('')
const duplicateTeamWarning = ref('')

// Team division edit
const editingTeamId = ref<number | null>(null)
const editTeamDivision = ref('')

// Quizzer add
const addingQuizzerTeamId = ref<number | null>(null) // -1 = unassigned pool
const newQuizzerName = ref('')
const addQuizzerError = ref('')

// Quizzer rename
const renamingQuizzerId = ref<number | null>(null)
const renameValue = ref('')

// Drag
const dragging = ref<{ quizzerId: number; fromTeamId: number | null } | null>(null)
const dragOverTeamId = ref<number | null | undefined>(undefined)

// ---- Derived ----

const selectedChurch = computed(
  () => churches.value.find((c) => c.id === selectedChurchId.value) ?? null,
)

function canEdit(church: Church | null): boolean {
  if (!church) return false
  if (isSuperuser.value) return true
  return church.createdBy === myUserId.value
}

const canEditSelected = computed(() => canEdit(selectedChurch.value))

const unassigned = computed(() =>
  allQuizzers.value.filter((q) => assignments.value[q.quizzerId] === null),
)

function quizzersForTeam(teamId: number) {
  return allQuizzers.value.filter((q) => assignments.value[q.quizzerId] === teamId)
}

function teamLabel(team: Team) {
  return `${selectedChurch.value?.shortName ?? '?'} ${team.number}`
}

function duplicateDivisionWarning(division: string): string | null {
  if (!division.trim()) return null
  const exists = teams.value.some((t) => t.division.toLowerCase() === division.trim().toLowerCase())
  return exists
    ? `A team in ${division} already exists for this church. Contact the coach to join that team.`
    : null
}

// ---- Load ----

async function load() {
  loading.value = true
  error.value = ''
  try {
    const sessionUser = session.value?.data?.user
    myUserId.value = sessionUser?.id ?? null
    isSuperuser.value = (sessionUser as Record<string, unknown> | undefined)?.role === 'superuser'

    const [meetRes, churchRes, myMeetsRes] = await Promise.all([
      getMeet(props.id),
      listChurches(props.id),
      getMyMeets(),
    ])
    meet.value = meetRes.meet
    churches.value = churchRes.churches

    const membership = myMeetsRes.memberships.find((m) => m.meetId === props.id)
    if (!membership) {
      router.replace({ name: 'home' })
      return
    }

    if (churches.value.length > 0) {
      const myChurch =
        churches.value.find((c) => c.createdBy === myUserId.value) ?? churches.value[0]!
      await selectChurch(myChurch.id)
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function selectChurch(churchId: number) {
  selectedChurchId.value = churchId
  teams.value = []
  allQuizzers.value = []
  assignments.value = {}

  const teamRes = await listTeams(churchId)
  teams.value = teamRes.teams

  const rosterResults = await Promise.all(teams.value.map((t) => listQuizzers(t.id)))
  for (let i = 0; i < teams.value.length; i++) {
    for (const q of rosterResults[i]!.quizzers) {
      allQuizzers.value.push(q)
      assignments.value[q.quizzerId] = teams.value[i]!.id
    }
  }
}

function startAddToPool() {
  addingQuizzerTeamId.value = -1
  newQuizzerName.value = ''
}

function startAddToTeam(teamId: number) {
  addingQuizzerTeamId.value = teamId
  newQuizzerName.value = ''
  addQuizzerError.value = ''
}

onMounted(load)

// ---- Church actions ----

async function submitCreateChurch() {
  createChurchError.value = ''
  creatingChurch.value = true
  try {
    const res = await createChurch(props.id, churchForm.value)
    churches.value.push(res.church)
    showCreateChurch.value = false
    churchForm.value = { name: '', shortName: '' }
    await selectChurch(res.church.id)
  } catch (e) {
    createChurchError.value = (e as Error).message
  } finally {
    creatingChurch.value = false
  }
}

// ---- Team actions ----

function startAddTeam() {
  addingTeam.value = true
  newTeamDivision.value = ''
  createTeamError.value = ''
  duplicateTeamWarning.value = ''
}

function onNewTeamDivisionChange() {
  duplicateTeamWarning.value = duplicateDivisionWarning(newTeamDivision.value) ?? ''
}

async function submitCreateTeam() {
  if (!selectedChurchId.value || !newTeamDivision.value.trim()) return
  const warning = duplicateDivisionWarning(newTeamDivision.value)
  if (warning) {
    duplicateTeamWarning.value = warning
    return
  }
  createTeamError.value = ''
  try {
    const res = await createTeam(selectedChurchId.value, { division: newTeamDivision.value.trim() })
    teams.value.push(res.team)
    addingTeam.value = false
    newTeamDivision.value = ''
  } catch (e) {
    createTeamError.value = (e as Error).message
  }
}

function startEditTeam(team: Team) {
  editingTeamId.value = team.id
  editTeamDivision.value = team.division
}

async function submitEditTeam(teamId: number) {
  if (!editTeamDivision.value.trim()) {
    editingTeamId.value = null
    return
  }
  try {
    const res = await updateTeam(teamId, { division: editTeamDivision.value.trim() })
    const t = teams.value.find((t) => t.id === teamId)
    if (t && res.team) t.division = res.team.division
    editingTeamId.value = null
  } catch (e) {
    alert((e as Error).message)
  }
}

// ---- Quizzer actions ----

async function submitAddQuizzer(teamId: number) {
  if (!newQuizzerName.value.trim()) return
  addQuizzerError.value = ''
  try {
    const res = await addQuizzer(teamId, newQuizzerName.value.trim())
    allQuizzers.value.push(res.quizzer)
    assignments.value[res.quizzer.quizzerId] = teamId
    newQuizzerName.value = ''
    addingQuizzerTeamId.value = null
  } catch (e) {
    addQuizzerError.value = (e as Error).message
  }
}

let tempId = -1
function submitAddUnassigned() {
  if (!newQuizzerName.value.trim()) return
  const q: Quizzer = { quizzerId: tempId--, name: newQuizzerName.value.trim() }
  allQuizzers.value.push(q)
  assignments.value[q.quizzerId] = null
  newQuizzerName.value = ''
  addingQuizzerTeamId.value = null
}

async function submitRename(teamId: number | null, quizzerId: number) {
  if (!renameValue.value.trim()) {
    renamingQuizzerId.value = null
    return
  }
  if (teamId === null) {
    const q = allQuizzers.value.find((q) => q.quizzerId === quizzerId)
    if (q) q.name = renameValue.value.trim()
    renamingQuizzerId.value = null
    return
  }
  try {
    const res = await updateQuizzer(teamId, quizzerId, renameValue.value.trim())
    const q = allQuizzers.value.find((q) => q.quizzerId === quizzerId)
    if (q) q.name = res.quizzer.name
    renamingQuizzerId.value = null
  } catch (_e) {
    // keep open on error
  }
}

async function handleRemoveQuizzer(teamId: number | null, quizzerId: number) {
  if (teamId === null) {
    allQuizzers.value = allQuizzers.value.filter((q) => q.quizzerId !== quizzerId)
    delete assignments.value[quizzerId]
    return
  }
  try {
    await removeQuizzer(teamId, quizzerId)
    allQuizzers.value = allQuizzers.value.filter((q) => q.quizzerId !== quizzerId)
    delete assignments.value[quizzerId]
  } catch (e) {
    alert((e as Error).message)
  }
}

// ---- Drag & drop ----

function onDragStart(quizzerId: number, fromTeamId: number | null) {
  dragging.value = { quizzerId, fromTeamId }
}

function onDragEnd() {
  dragging.value = null
  dragOverTeamId.value = undefined
}

async function onDrop(toTeamId: number | null) {
  if (!dragging.value) return
  const { quizzerId, fromTeamId } = dragging.value
  dragging.value = null
  dragOverTeamId.value = undefined
  if (toTeamId === fromTeamId) return
  assignments.value[quizzerId] = toTeamId
  try {
    if (fromTeamId !== null && toTeamId !== null) {
      await removeQuizzer(fromTeamId, quizzerId)
      const q = allQuizzers.value.find((q) => q.quizzerId === quizzerId)!
      const res = await addQuizzer(toTeamId, q.name)
      const idx = allQuizzers.value.findIndex((q) => q.quizzerId === quizzerId)
      if (idx !== -1) allQuizzers.value[idx] = res.quizzer
      assignments.value[res.quizzer.quizzerId] = toTeamId
      delete assignments.value[quizzerId]
    } else if (fromTeamId !== null && toTeamId === null) {
      await removeQuizzer(fromTeamId, quizzerId)
    } else if (fromTeamId === null && toTeamId !== null) {
      const q = allQuizzers.value.find((q) => q.quizzerId === quizzerId)!
      const res = await addQuizzer(toTeamId, q.name)
      const idx = allQuizzers.value.findIndex((q) => q.quizzerId === quizzerId)
      if (idx !== -1) allQuizzers.value[idx] = res.quizzer
      assignments.value[res.quizzer.quizzerId] = toTeamId
      delete assignments.value[quizzerId]
    }
  } catch (e) {
    assignments.value[quizzerId] = fromTeamId
    alert((e as Error).message)
  }
}
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'meet', params: { id } })">
      ← QuizMeet
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet">
      <div class="page-header">
        <h2 class="page-title">Teams &amp; Rosters</h2>
        <span class="meet-name">{{ meet.name }}</span>
      </div>

      <!-- Church tabs -->
      <div class="church-bar">
        <div class="church-tabs">
          <button
            v-for="c in churches"
            :key="c.id"
            class="church-tab"
            :class="{ 'church-tab--active': c.id === selectedChurchId }"
            @click="selectChurch(c.id)"
          >
            {{ c.shortName }}<span class="church-tab-full"> {{ c.name }}</span>
          </button>
          <button class="church-tab church-tab--add" @click="showCreateChurch = true">
            + Church
          </button>
        </div>
      </div>

      <p v-if="!selectedChurch" class="state-msg">Add a church to get started.</p>

      <template v-else>
        <p v-if="!canEditSelected" class="notice">
          You can view {{ selectedChurch.name }}’s roster but only their coach can make changes.
        </p>

        <div class="roster-layout">
          <!-- Unassigned pool -->
          <div
            class="panel panel--pool"
            :class="{ 'panel--dragover': dragOverTeamId === null && dragging !== null }"
            @dragover.prevent="dragOverTeamId = null"
            @dragleave="dragOverTeamId = undefined"
            @drop.prevent="onDrop(null)"
          >
            <div class="panel-header">
              <h3 class="panel-title">Unassigned</h3>
            </div>

            <ul class="quizzer-list">
              <li
                v-for="q in unassigned"
                :key="q.quizzerId"
                class="quizzer-chip"
                :draggable="canEditSelected"
                @dragstart="canEditSelected && onDragStart(q.quizzerId, null)"
                @dragend="onDragEnd"
              >
                <template v-if="renamingQuizzerId === q.quizzerId">
                  <input
                    v-model="renameValue"
                    class="rename-input"
                    autofocus
                    @keyup.enter="submitRename(null, q.quizzerId)"
                    @keyup.escape="renamingQuizzerId = null"
                    @blur="submitRename(null, q.quizzerId)"
                  />
                </template>
                <template v-else>
                  <span
                    class="quizzer-name"
                    :class="{ 'quizzer-name--editable': canEditSelected }"
                    @dblclick="
                      canEditSelected && ((renamingQuizzerId = q.quizzerId), (renameValue = q.name))
                    "
                    >{{ q.name }}</span
                  >
                  <button
                    v-if="canEditSelected"
                    class="quizzer-remove"
                    title="Remove"
                    @click.stop="handleRemoveQuizzer(null, q.quizzerId)"
                  >
                    ×
                  </button>
                </template>
              </li>
            </ul>

            <template v-if="canEditSelected">
              <form
                v-if="addingQuizzerTeamId === -1"
                class="inline-add"
                @submit.prevent="submitAddUnassigned"
              >
                <input
                  v-model="newQuizzerName"
                  class="inline-add-input"
                  placeholder="Name"
                  autofocus
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
              <button v-else class="dashed-add" @click="startAddToPool()">+ Quizzer</button>
            </template>
          </div>

          <!-- Teams -->
          <div class="teams-area">
            <div class="teams-grid">
              <div
                v-for="team in teams"
                :key="team.id"
                class="team-card"
                :class="{ 'team-card--dragover': dragOverTeamId === team.id }"
                @dragover.prevent="dragOverTeamId = team.id"
                @dragleave="dragOverTeamId = undefined"
                @drop.prevent="onDrop(team.id)"
              >
                <div class="team-card-header">
                  <span class="team-label">{{ teamLabel(team) }}</span>
                  <select
                    v-if="editingTeamId === team.id"
                    v-model="editTeamDivision"
                    class="division-select"
                    autofocus
                    @change="submitEditTeam(team.id)"
                    @blur="submitEditTeam(team.id)"
                    @keyup.escape="editingTeamId = null"
                  >
                    <option v-for="div in meet.divisions" :key="div" :value="div">{{ div }}</option>
                  </select>
                  <span
                    v-else
                    class="division-pill"
                    :class="{ 'division-pill--editable': canEditSelected }"
                    :title="canEditSelected ? 'Click to change division' : undefined"
                    @click="canEditSelected && startEditTeam(team)"
                    >{{ team.division }}</span
                  >
                  <span class="team-count">{{ quizzersForTeam(team.id).length }}</span>
                </div>

                <ul class="quizzer-list">
                  <li
                    v-for="q in quizzersForTeam(team.id)"
                    :key="q.quizzerId"
                    class="quizzer-chip"
                    :draggable="canEditSelected"
                    @dragstart="canEditSelected && onDragStart(q.quizzerId, team.id)"
                    @dragend="onDragEnd"
                  >
                    <template v-if="renamingQuizzerId === q.quizzerId">
                      <input
                        v-model="renameValue"
                        class="rename-input"
                        autofocus
                        @keyup.enter="submitRename(team.id, q.quizzerId)"
                        @keyup.escape="renamingQuizzerId = null"
                        @blur="submitRename(team.id, q.quizzerId)"
                      />
                    </template>
                    <template v-else>
                      <span
                        class="quizzer-name"
                        :class="{ 'quizzer-name--editable': canEditSelected }"
                        @dblclick="
                          canEditSelected &&
                          ((renamingQuizzerId = q.quizzerId), (renameValue = q.name))
                        "
                        >{{ q.name }}</span
                      >
                      <button
                        v-if="canEditSelected"
                        class="quizzer-remove"
                        title="Remove"
                        @click.stop="handleRemoveQuizzer(team.id, q.quizzerId)"
                      >
                        ×
                      </button>
                    </template>
                  </li>
                </ul>

                <template v-if="canEditSelected">
                  <form
                    v-if="addingQuizzerTeamId === team.id"
                    class="inline-add"
                    @submit.prevent="submitAddQuizzer(team.id)"
                  >
                    <input
                      v-model="newQuizzerName"
                      class="inline-add-input"
                      placeholder="Name"
                      autofocus
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
                  <button v-else class="dashed-add" @click="startAddToTeam(team.id)">
                    + Quizzer
                  </button>
                </template>
              </div>

              <!-- + Team card -->
              <div v-if="canEditSelected" class="team-card team-card--add">
                <form v-if="addingTeam" class="add-team-form" @submit.prevent="submitCreateTeam">
                  <select
                    v-model="newTeamDivision"
                    class="division-select"
                    autofocus
                    required
                    @change="onNewTeamDivisionChange"
                  >
                    <option value="" disabled>Division…</option>
                    <option v-for="div in meet.divisions" :key="div" :value="div">{{ div }}</option>
                  </select>
                  <p v-if="duplicateTeamWarning" class="warn-msg">{{ duplicateTeamWarning }}</p>
                  <p v-if="createTeamError" class="field-error">{{ createTeamError }}</p>
                  <div class="inline-add-actions">
                    <button
                      type="submit"
                      class="btn btn--primary btn--sm"
                      :disabled="!!duplicateTeamWarning"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      class="btn btn--ghost btn--sm"
                      @click="addingTeam = false"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
                <button v-else class="dashed-add dashed-add--fill" @click="startAddTeam">
                  + Team
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Create church modal -->
    <div v-if="showCreateChurch" class="modal-backdrop" @click.self="showCreateChurch = false">
      <div class="modal">
        <h3 class="modal-title">Add church</h3>
        <form @submit.prevent="submitCreateChurch">
          <div class="field">
            <label class="field-label" for="church-name">Full name</label>
            <input id="church-name" v-model="churchForm.name" class="field-input" required />
          </div>
          <div class="field">
            <label class="field-label" for="church-short">Short name</label>
            <input
              id="church-short"
              v-model="churchForm.shortName"
              class="field-input"
              placeholder="e.g. GCC"
              required
            />
          </div>
          <p v-if="createChurchError" class="field-error">{{ createChurchError }}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn--secondary" @click="showCreateChurch = false">
              Cancel
            </button>
            <button type="submit" class="btn btn--primary" :disabled="creatingChurch">
              {{ creatingChurch ? 'Adding…' : 'Add' }}
            </button>
          </div>
        </form>
      </div>
    </div>
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

.notice {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.5rem 0.875rem;
  margin-bottom: 1rem;
}

.church-bar {
  margin-bottom: 1.25rem;
}

.church-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.church-tab {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.3rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  color: var(--color-text-muted);
  transition:
    border-color 0.15s,
    color 0.15s;
}

.church-tab-full {
  font-weight: 400;
  font-size: 0.75rem;
  color: var(--color-text-faint);
}

.church-tab:hover {
  border-color: var(--color-accent);
  color: var(--color-text);
}
.church-tab--active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.church-tab--add {
  border-style: dashed;
  font-weight: 400;
  color: var(--color-text-faint);
}
.church-tab--add:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.roster-layout {
  display: grid;
  grid-template-columns: 13rem 1fr;
  gap: 1.25rem;
  align-items: start;
}

.panel {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
  padding: 0.875rem;
  min-height: 10rem;
  transition: border-color 0.1s;
}

.panel--dragover {
  border-color: var(--color-accent);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.panel-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-faint);
}

.teams-area {
  min-width: 0;
}

.teams-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.875rem;
  align-items: start;
}

.team-card {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
  padding: 0.75rem;
  flex: 1 1 11rem;
  max-width: 14rem;
  min-height: 7rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  transition: border-color 0.1s;
}

.team-card--dragover {
  border-color: var(--color-accent);
  background: var(--color-bg);
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
  margin-bottom: 0.25rem;
}

.team-label {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-heading);
  flex-shrink: 0;
}

.division-pill {
  font-size: 0.7rem;
  padding: 0.15rem 0.45rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 99px;
  color: var(--color-text-muted);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.division-pill--editable {
  cursor: pointer;
}
.division-pill--editable:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.division-select {
  flex: 1;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  padding: 0.15rem 0.3rem;
  font-size: 0.75rem;
  font-family: inherit;
  color: var(--color-text);
  outline: none;
}

.team-count {
  font-size: 0.7rem;
  color: var(--color-text-faint);
  background: var(--color-bg);
  border-radius: 999px;
  padding: 0 0.4rem;
  flex-shrink: 0;
}

.quizzer-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.quizzer-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
  user-select: none;
}

.quizzer-chip[draggable='true'] {
  cursor: grab;
}
.quizzer-chip[draggable='true']:active {
  cursor: grabbing;
}

.quizzer-name {
  flex: 1;
}
.quizzer-name--editable {
  cursor: text;
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

.add-team-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.25rem;
  height: 100%;
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

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  padding: 1.5rem;
  width: 100%;
  max-width: 22rem;
}

.modal-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 1rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

.field {
  margin-bottom: 0.875rem;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 0.3rem;
}

.field-input {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.4rem 0.65rem;
  font-size: 0.875rem;
  color: var(--color-text);
  font-family: inherit;
  outline: none;
  width: 100%;
  min-width: 0;
}

.field-input:focus {
  border-color: var(--color-accent);
}
</style>
