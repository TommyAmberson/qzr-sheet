<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  getMeet,
  listChurches,
  createChurch,
  listTeams,
  createTeam,
  listQuizzers,
  addQuizzer,
  updateQuizzer,
  removeQuizzer,
  type Meet,
  type Church,
  type Team,
  type Quizzer,
} from '../api'

const props = defineProps<{ id: number }>()
const router = useRouter()

// ---- State ----

const meet = ref<Meet | null>(null)
const churches = ref<Church[]>([])
const selectedChurchId = ref<number | null>(null)

const teams = ref<Team[]>([])
const allQuizzers = ref<Quizzer[]>([]) // flat roster for selected church (across all teams)

// quizzerId → teamId (null = unassigned)
const assignments = ref<Record<number, number | null>>({})

const loading = ref(true)
const error = ref('')

// Church create form
const showCreateChurch = ref(false)
const churchForm = ref({ name: '', shortName: '' })
const creatingChurch = ref(false)
const createChurchError = ref('')

// Team create
const creatingTeam = ref(false)
const newTeamDivision = ref('')
const createTeamError = ref('')

// Quizzer add
const addingQuizzerTeamId = ref<number | null>(null)
const newQuizzerName = ref('')
const addQuizzerError = ref('')

// Inline rename
const renamingQuizzerId = ref<number | null>(null)
const renameValue = ref('')

// Drag state
const dragging = ref<{ quizzerId: number; fromTeamId: number | null } | null>(null)
const dragOverTeamId = ref<number | null>(null) // null = unassigned zone

// ---- Derived ----

const selectedChurch = computed(
  () => churches.value.find((c) => c.id === selectedChurchId.value) ?? null,
)

const unassigned = computed(() =>
  allQuizzers.value.filter((q) => assignments.value[q.quizzerId] === null),
)

function quizzersForTeam(teamId: number) {
  return allQuizzers.value.filter((q) => assignments.value[q.quizzerId] === teamId)
}

// ---- Load ----

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [meetRes, churchRes] = await Promise.all([getMeet(props.id), listChurches(props.id)])
    meet.value = meetRes.meet
    churches.value = churchRes.churches

    if (churches.value.length > 0) {
      await selectChurch(churches.value[0]!.id)
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

  const [teamRes] = await Promise.all([listTeams(churchId)])
  teams.value = teamRes.teams

  // Load quizzers for every team in parallel
  const rosterResults = await Promise.all(teams.value.map((t) => listQuizzers(t.id)))
  for (let i = 0; i < teams.value.length; i++) {
    const team = teams.value[i]!
    for (const q of rosterResults[i]!.quizzers) {
      allQuizzers.value.push(q)
      assignments.value[q.quizzerId] = team.id
    }
  }
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

async function submitCreateTeam() {
  if (!selectedChurchId.value || !newTeamDivision.value) return
  createTeamError.value = ''
  creatingTeam.value = true
  try {
    const res = await createTeam(selectedChurchId.value, { division: newTeamDivision.value })
    teams.value.push(res.team)
    newTeamDivision.value = ''
  } catch (e) {
    createTeamError.value = (e as Error).message
  } finally {
    creatingTeam.value = false
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

// Adding to the unassigned pool requires a temporary team or direct-to-team assignment.
// We add to the first team as a placeholder, then immediately unassign (remove from team roster).
// Simpler UX: just prompt which team or use a scratch team. For now, pool entries are local-only
// until dragged onto a team — we give them a temporary negative id.
let tempId = -1
function submitAddUnassigned() {
  if (!newQuizzerName.value.trim()) return
  const q: Quizzer = { quizzerId: tempId--, name: newQuizzerName.value.trim() }
  allQuizzers.value.push(q)
  assignments.value[q.quizzerId] = null
  newQuizzerName.value = ''
  addingQuizzerTeamId.value = null
}

async function submitRename(teamId: number, quizzerId: number) {
  if (!renameValue.value.trim()) return
  try {
    const res = await updateQuizzer(teamId, quizzerId, renameValue.value.trim())
    const q = allQuizzers.value.find((q) => q.quizzerId === quizzerId)
    if (q) q.name = res.quizzer.name
    renamingQuizzerId.value = null
  } catch (_e) {
    // keep editing open on error
  }
}

async function handleRemoveQuizzer(teamId: number | null, quizzerId: number) {
  if (teamId === null) return // unassigned quizzers aren't persisted yet
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
  dragOverTeamId.value = null
}

async function onDrop(toTeamId: number | null) {
  if (!dragging.value) return
  const { quizzerId, fromTeamId } = dragging.value
  dragging.value = null
  dragOverTeamId.value = null

  if (toTeamId === fromTeamId) return

  // Optimistically update assignment
  assignments.value[quizzerId] = toTeamId

  try {
    if (fromTeamId !== null && toTeamId !== null) {
      // Move: remove from old team, add to new team
      await removeQuizzer(fromTeamId, quizzerId)
      const q = allQuizzers.value.find((q) => q.quizzerId === quizzerId)!
      const res = await addQuizzer(toTeamId, q.name)
      // Replace identity so quizzerId stays consistent with server
      const idx = allQuizzers.value.findIndex((q) => q.quizzerId === quizzerId)
      if (idx !== -1) allQuizzers.value[idx] = res.quizzer
      assignments.value[res.quizzer.quizzerId] = toTeamId
      delete assignments.value[quizzerId]
    } else if (fromTeamId !== null && toTeamId === null) {
      // Move to unassigned: remove from team but keep in local list
      await removeQuizzer(fromTeamId, quizzerId)
    } else if (fromTeamId === null && toTeamId !== null) {
      // Move from unassigned onto a team
      const q = allQuizzers.value.find((q) => q.quizzerId === quizzerId)!
      const res = await addQuizzer(toTeamId, q.name)
      const idx = allQuizzers.value.findIndex((q) => q.quizzerId === quizzerId)
      if (idx !== -1) allQuizzers.value[idx] = res.quizzer
      assignments.value[res.quizzer.quizzerId] = toTeamId
      delete assignments.value[quizzerId]
    }
  } catch (e) {
    // Revert optimistic update
    assignments.value[quizzerId] = fromTeamId
    alert((e as Error).message)
  }
}

function teamLabel(team: Team) {
  return `${selectedChurch.value?.shortName ?? '?'} ${team.number}`
}
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'coach-meets' })">← My meets</button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="meet">
      <div class="page-header">
        <h2 class="page-title">{{ meet.name }}</h2>
        <span class="meet-meta"
          >{{ meet.dateFrom
          }}{{ meet.dateTo && meet.dateTo !== meet.dateFrom ? ` – ${meet.dateTo}` : '' }}</span
        >
      </div>

      <!-- Church selector -->
      <div class="church-bar">
        <div class="church-tabs">
          <button
            v-for="c in churches"
            :key="c.id"
            class="church-tab"
            :class="{ 'church-tab--active': c.id === selectedChurchId }"
            @click="selectChurch(c.id)"
          >
            {{ c.name }}
          </button>
          <button class="church-tab church-tab--add" @click="showCreateChurch = true">
            + Church
          </button>
        </div>
      </div>

      <!-- No church selected -->
      <p v-if="!selectedChurch" class="state-msg">Add a church to get started.</p>

      <template v-else>
        <!-- Two-panel layout -->
        <div class="roster-layout">
          <!-- Left: unassigned pool -->
          <div
            class="panel panel--pool"
            :class="{ 'panel--dragover': dragOverTeamId === null && dragging !== null }"
            @dragover.prevent="dragOverTeamId = null"
            @dragleave="dragOverTeamId = undefined as unknown as null"
            @drop.prevent="onDrop(null)"
          >
            <div class="panel-header">
              <h3 class="panel-title">Unassigned</h3>
              <button
                class="add-btn"
                title="Add quizzer to pool"
                @click="
                  addingQuizzerTeamId = -1
                  newQuizzerName = ''
                "
              >
                +
              </button>
            </div>

            <ul class="quizzer-list">
              <li
                v-for="q in unassigned"
                :key="q.quizzerId"
                class="quizzer-chip"
                draggable="true"
                @dragstart="onDragStart(q.quizzerId, null)"
                @dragend="onDragEnd"
              >
                <template v-if="renamingQuizzerId === q.quizzerId">
                  <input
                    v-model="renameValue"
                    class="rename-input"
                    autofocus
                    @keyup.enter="submitRename(assignments[q.quizzerId]!, q.quizzerId)"
                    @keyup.escape="renamingQuizzerId = null"
                    @blur="renamingQuizzerId = null"
                  />
                </template>
                <template v-else>
                  <span
                    class="quizzer-name"
                    @dblclick="
                      renamingQuizzerId = q.quizzerId
                      renameValue = q.name
                    "
                  >
                    {{ q.name }}
                  </span>
                </template>
              </li>
            </ul>

            <!-- Add to pool inline form -->
            <form
              v-if="addingQuizzerTeamId === -1"
              class="inline-add"
              @submit.prevent="submitAddUnassigned"
            >
              <input
                v-model="newQuizzerName"
                class="field-input"
                placeholder="Name"
                autofocus
                @keyup.escape="addingQuizzerTeamId = null"
              />
              <button type="submit" class="btn btn--primary btn--sm">Add</button>
              <button
                type="button"
                class="btn btn--secondary btn--sm"
                @click="addingQuizzerTeamId = null"
              >
                Cancel
              </button>
              <p v-if="addQuizzerError" class="field-error">{{ addQuizzerError }}</p>
            </form>
          </div>

          <!-- Right: teams -->
          <div class="panel panel--teams">
            <div class="panel-header">
              <h3 class="panel-title">Teams</h3>
            </div>

            <div class="teams-grid">
              <div
                v-for="team in teams"
                :key="team.id"
                class="team-card"
                :class="{ 'team-card--dragover': dragOverTeamId === team.id }"
                @dragover.prevent="dragOverTeamId = team.id"
                @dragleave="dragOverTeamId = null"
                @drop.prevent="onDrop(team.id)"
              >
                <div class="team-card-header">
                  <span class="team-name">{{ teamLabel(team) }}</span>
                  <span class="team-division">{{ team.division }}</span>
                  <span class="team-count">{{ quizzersForTeam(team.id).length }}</span>
                </div>

                <ul class="quizzer-list">
                  <li
                    v-for="q in quizzersForTeam(team.id)"
                    :key="q.quizzerId"
                    class="quizzer-chip"
                    draggable="true"
                    @dragstart="onDragStart(q.quizzerId, team.id)"
                    @dragend="onDragEnd"
                  >
                    <template v-if="renamingQuizzerId === q.quizzerId">
                      <input
                        v-model="renameValue"
                        class="rename-input"
                        autofocus
                        @keyup.enter="submitRename(team.id, q.quizzerId)"
                        @keyup.escape="renamingQuizzerId = null"
                        @blur="renamingQuizzerId = null"
                      />
                    </template>
                    <template v-else>
                      <span
                        class="quizzer-name"
                        @dblclick="
                          renamingQuizzerId = q.quizzerId
                          renameValue = q.name
                        "
                        >{{ q.name }}</span
                      >
                      <button
                        class="quizzer-remove"
                        title="Remove"
                        @click.stop="handleRemoveQuizzer(team.id, q.quizzerId)"
                      >
                        ×
                      </button>
                    </template>
                  </li>
                </ul>

                <!-- Add quizzer directly to team -->
                <form
                  v-if="addingQuizzerTeamId === team.id"
                  class="inline-add"
                  @submit.prevent="submitAddQuizzer(team.id)"
                >
                  <input
                    v-model="newQuizzerName"
                    class="field-input"
                    placeholder="Name"
                    autofocus
                    @keyup.escape="addingQuizzerTeamId = null"
                  />
                  <button type="submit" class="btn btn--primary btn--sm">Add</button>
                  <button
                    type="button"
                    class="btn btn--secondary btn--sm"
                    @click="addingQuizzerTeamId = null"
                  >
                    Cancel
                  </button>
                  <p v-if="addQuizzerError" class="field-error">{{ addQuizzerError }}</p>
                </form>
                <button
                  v-else
                  class="add-to-team-btn"
                  @click="
                    addingQuizzerTeamId = team.id
                    newQuizzerName = ''
                    addQuizzerError = ''
                  "
                >
                  + Quizzer
                </button>
              </div>
            </div>

            <!-- Add team form -->
            <form class="add-team-form" @submit.prevent="submitCreateTeam">
              <select v-model="newTeamDivision" class="field-input field-input--select" required>
                <option value="" disabled>Division…</option>
                <option v-for="div in meet.divisions" :key="div" :value="div">{{ div }}</option>
              </select>
              <button
                type="submit"
                class="btn btn--secondary"
                :disabled="creatingTeam || !newTeamDivision"
              >
                {{ creatingTeam ? 'Adding…' : '+ Team' }}
              </button>
              <p v-if="createTeamError" class="field-error">{{ createTeamError }}</p>
            </form>
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

.meet-meta {
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

/* Church tabs */
.church-bar {
  margin-bottom: 1.5rem;
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
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  color: var(--color-text-muted);
  transition:
    border-color 0.15s,
    color 0.15s;
}

.church-tab:hover {
  border-color: var(--color-accent);
  color: var(--color-text);
}

.church-tab--active {
  border-color: var(--color-accent);
  color: var(--color-accent);
  font-weight: 600;
}

.church-tab--add {
  border-style: dashed;
  color: var(--color-text-faint);
}

.church-tab--add:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

/* Two-panel layout */
.roster-layout {
  display: grid;
  grid-template-columns: 14rem 1fr;
  gap: 1.25rem;
  align-items: start;
}

.panel {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
  padding: 0.875rem;
  min-height: 12rem;
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
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-heading);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.add-btn {
  background: none;
  border: none;
  font-size: 1rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  font-family: inherit;
  padding: 0 0.25rem;
}

.add-btn:hover {
  color: var(--color-accent);
}

/* Teams */
.teams-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.875rem;
  margin-bottom: 1rem;
}

.team-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.75rem;
  min-width: 10rem;
  min-height: 6rem;
  flex: 1 1 10rem;
  max-width: 14rem;
  transition: border-color 0.1s;
}

.team-card--dragover {
  border-color: var(--color-accent);
  background: var(--color-bg-raised);
}

.team-card-header {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.team-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-heading);
}

.team-division {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  flex: 1;
}

.team-count {
  font-size: 0.7rem;
  color: var(--color-text-faint);
  background: var(--color-bg-raised);
  border-radius: 999px;
  padding: 0 0.4rem;
}

/* Quizzers */
.quizzer-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.5rem;
}

.quizzer-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
  cursor: grab;
  user-select: none;
}

.quizzer-chip:active {
  cursor: grabbing;
}

.quizzer-name {
  flex: 1;
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

/* Add team form */
.add-team-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.25rem;
}

.add-to-team-btn {
  width: 100%;
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 4px;
  padding: 0.25rem;
  font-size: 0.75rem;
  color: var(--color-text-faint);
  cursor: pointer;
  font-family: inherit;
  text-align: center;
}

.add-to-team-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

/* Inline add form */
.inline-add {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.4rem;
}

.inline-add .field-input {
  font-size: 0.8rem;
}

.inline-add .btn {
  align-self: flex-start;
}

/* Inputs / buttons */
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

.field-input--select {
  width: auto;
}

.field-error {
  font-size: 0.8rem;
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
  padding: 0.25rem 0.6rem;
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

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Modal */
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
</style>
