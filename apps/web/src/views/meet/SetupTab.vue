<script setup lang="ts">
import { vFocus } from '../../directives'
import { DivisionInput } from '@qzr/ui'
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { MEET_PHASES, type MeetPhase, bareDivision, findDivision } from '@qzr/shared'
import {
  updateMeet,
  createOfficialCode,
  deleteOfficialCode,
  setMeetPhase,
  getTemplateInfo,
  downloadTemplate,
  uploadTemplate,
  type TemplateInfo,
} from '../../api'
import { saveFile } from '../../downloads'
import MeetAccessDialog from '../../components/MeetAccessDialog.vue'
import StatsSettings from '../../components/StatsSettings.vue'
import { useMeetPage } from '../../meetPage'

const router = useRouter()

// The page's one copy of the meet, so an edit here shows in its header and every tab
const { slug, detail, isAdmin, isSuperuser } = useMeetPage()
const meetId = computed(() => detail.value?.meet.id ?? null)
const loading = ref(true)
const error = ref('')

const access = ref<InstanceType<typeof MeetAccessDialog> | null>(null)

// Inline editing
const editing = ref(false)
const editForm = ref({
  name: '',
  dateFrom: '',
  dateTo: '',
  viewerCode: '',
  divisions: [] as string[],
})
const newDivision = ref('')
const saving = ref(false)
const saveError = ref('')

// Add room
const showAddRoom = ref(false)
const newRoomLabel = ref('')
const addingRoom = ref(false)
const addRoomError = ref('')

// Phase header
const phaseSaving = ref(false)
const phaseError = ref('')

const currentPhase = computed<MeetPhase>(() => detail.value?.meet.phase ?? 'registration')
const phaseIdx = computed(() => MEET_PHASES.indexOf(currentPhase.value))
const nextPhase = computed<MeetPhase | null>(() =>
  phaseIdx.value < MEET_PHASES.length - 1 ? MEET_PHASES[phaseIdx.value + 1]! : null,
)
const prevPhase = computed<MeetPhase | null>(() =>
  phaseIdx.value > 0 ? MEET_PHASES[phaseIdx.value - 1]! : null,
)
const canAdvancePhase = computed(() => nextPhase.value !== null)
const canRevertPhase = computed(() => prevPhase.value !== null)
const phaseAdvanceTitle = computed(() =>
  nextPhase.value ? `Advance to ${phaseLabel(nextPhase.value)}` : 'Already in final phase',
)
const phaseRevertTitle = computed(() =>
  prevPhase.value
    ? `Revert to ${phaseLabel(prevPhase.value)} (flagged as unusual)`
    : 'No earlier phase',
)

function phaseLabel(p: MeetPhase | undefined): string {
  const phase = p ?? 'registration'
  return phase[0]!.toUpperCase() + phase.slice(1)
}

async function advancePhase(direction: 'advance' | 'revert') {
  if (!detail.value) return
  const target = direction === 'advance' ? nextPhase.value : prevPhase.value
  if (!target) return
  if (
    direction === 'revert' &&
    !confirm(`Revert to ${phaseLabel(target)}? Phase reverses are unusual.`)
  ) {
    return
  }
  phaseSaving.value = true
  phaseError.value = ''
  try {
    const res = await setMeetPhase(detail.value.meet.id, target)
    detail.value = {
      ...detail.value,
      meet: { ...detail.value.meet, phase: res.phase },
    }
  } catch (e) {
    phaseError.value = e instanceof Error ? e.message : 'Failed to change phase'
  } finally {
    phaseSaving.value = false
  }
}

async function load() {
  const id = meetId.value
  if (id === null) return
  try {
    templateError.value = ''
    // A template that can't be looked up leaves the rest of the page as it is, and says so
    template.value = await getTemplateInfo(id).catch((e: Error) => {
      templateError.value = `Couldn't look up the meet's template: ${e.message}`
      return null
    })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

// ---- Scoring template ----

/** The meet's Scoresheet.ots, which .ods downloads fill and a room falls back to; null with none */
const template = ref<TemplateInfo | null>(null)
const templateInput = ref<HTMLInputElement | null>(null)
const uploadingTemplate = ref(false)
const templateError = ref('')

async function saveTemplate() {
  templateError.value = ''
  try {
    const { bytes, fileName } = await downloadTemplate(meetId.value!)
    saveFile(bytes, fileName, 'application/vnd.oasis.opendocument.spreadsheet-template')
  } catch (e) {
    templateError.value = (e as Error).message
  }
}

async function onTemplatePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Cleared, so picking the same file again still fires a change
  input.value = ''
  if (!file) return
  uploadingTemplate.value = true
  templateError.value = ''
  try {
    template.value = await uploadTemplate(meetId.value!, file)
  } catch (e) {
    templateError.value = (e as Error).message
  } finally {
    uploadingTemplate.value = false
  }
}

// ---- Meet editing ----

function startEdit() {
  const m = detail.value?.meet
  if (!m) return
  editForm.value = {
    name: m.name,
    dateFrom: m.dateFrom,
    dateTo: m.dateTo ?? '',
    viewerCode: m.viewerCode,
    divisions: [...m.divisions],
  }
  newDivision.value = ''
  editing.value = true
}

function addDivision() {
  const d = bareDivision(newDivision.value)
  if (!d || findDivision(editForm.value.divisions, d) !== undefined) return
  editForm.value.divisions.push(d)
  newDivision.value = ''
}

function removeDivision(i: number) {
  editForm.value.divisions.splice(i, 1)
}

async function saveEdit() {
  if (!detail.value) return
  saveError.value = ''
  saving.value = true
  try {
    const res = await updateMeet(detail.value.meet.id, { ...editForm.value })
    detail.value = { ...detail.value, meet: res.meet }
    editing.value = false
    if (res.meet.viewerCode !== slug.value) {
      // Setup again under the meet's new address, as the reader had it
      router.replace({
        name: 'meet-setup',
        params: { slug: res.meet.viewerCode },
        query: router.currentRoute.value.query,
      })
    }
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

// ---- Add room ----

async function handleAddRoom() {
  addRoomError.value = ''
  addingRoom.value = true
  try {
    const res = await createOfficialCode(meetId.value!, newRoomLabel.value.trim())
    detail.value!.officialCodes.push(res.officialCode)
    newRoomLabel.value = ''
    showAddRoom.value = false
    access.value?.openRoomCodeDialog(res.officialCode, res.code)
  } catch (e) {
    addRoomError.value = (e as Error).message
  } finally {
    addingRoom.value = false
  }
}

async function handleDeleteRoom(codeId: number) {
  if (!confirm('Delete this room and its code?')) return
  try {
    await deleteOfficialCode(meetId.value!, codeId)
    detail.value!.officialCodes = detail.value!.officialCodes.filter((c) => c.id !== codeId)
  } catch (e) {
    alert((e as Error).message)
  }
}

async function copyViewerCode() {
  const code = detail.value?.meet.viewerCode
  if (code) await navigator.clipboard.writeText(code)
}

async function shareMeet() {
  const m = detail.value?.meet
  if (!m) return
  const url = window.location.href
  if (navigator.share) {
    await navigator.share({ title: m.name, url }).catch(() => {})
  } else {
    await navigator.clipboard.writeText(url)
  }
}

watch(meetId, load, { immediate: true })

// Setup is its admins' tab: a member who opens it by address is shown the schedule instead
watch(
  () => [detail.value !== null, isAdmin.value],
  ([loaded, admin]) => {
    if (loaded && !admin) void router.replace({ name: 'meet', params: { slug: slug.value } })
  },
  { immediate: true },
)
</script>

<template>
  <div class="setup-tab">
    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="detail">
      <!-- Meet info -->
      <div class="page-header">
        <template v-if="!editing">
          <div class="meet-info">
            <div class="meet-title-row">
              <h3 class="section-title">Details</h3>
            </div>
            <div v-if="detail.meet.divisions.length" class="division-tags">
              <span class="division-tags-label">Divisions:</span>
              <span v-for="d in detail.meet.divisions" :key="d" class="division-tag">{{ d }}</span>
            </div>
            <div class="viewer-code-row">
              <span class="viewer-code"
                >Viewer code: <code>{{ detail.meet.viewerCode }}</code></span
              >
              <button class="inline-icon-btn" title="Copy viewer code" @click="copyViewerCode">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button class="inline-icon-btn" title="Share meet link" @click="shareMeet">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </button>
            </div>
          </div>
          <button v-if="isAdmin" class="icon-btn" title="Edit meet" @click="startEdit">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </template>
        <form v-else class="edit-card" @submit.prevent="saveEdit">
          <h3 class="edit-card-title">Edit Meet</h3>

          <label class="field-label">
            Name
            <input v-model="editForm.name" class="field-input" required />
          </label>

          <div class="edit-date-row">
            <label class="field-label">
              Start date
              <input v-model="editForm.dateFrom" class="field-input" type="date" required />
            </label>
            <label class="field-label">
              End date
              <input v-model="editForm.dateTo" class="field-input" type="date" />
            </label>
          </div>

          <div class="field-label">
            Divisions
            <div class="divisions-edit">
              <div v-if="editForm.divisions.length" class="division-tags">
                <span
                  v-for="(d, i) in editForm.divisions"
                  :key="d"
                  class="division-tag division-tag--removable"
                >
                  {{ d }}
                  <button type="button" class="division-remove" @click="removeDivision(i)">
                    &times;
                  </button>
                </span>
              </div>
              <div class="division-add">
                <DivisionInput
                  v-model="newDivision"
                  class="field-input"
                  placeholder="Add division…"
                  aria-label="New division"
                  @keydown.enter.prevent="addDivision"
                />
                <button type="button" class="btn btn--secondary btn--sm" @click="addDivision">
                  Add
                </button>
              </div>
            </div>
          </div>

          <label class="field-label">
            Viewer code
            <input
              v-model.trim="editForm.viewerCode"
              class="field-input"
              required
              pattern="\s*(?![0-9]+\s*$)[A-Za-z0-9\-]+\s*"
              title="Letters, digits, and hyphens, not only digits"
            />
            <span class="field-hint">Changing this updates the meet URL.</span>
          </label>

          <p v-if="saveError" class="field-error">{{ saveError }}</p>

          <div class="edit-card-actions">
            <button type="button" class="btn btn--ghost" @click="editing = false">Cancel</button>
            <button type="submit" class="btn btn--primary" :disabled="saving">
              {{ saving ? 'Saving…' : 'Save Changes' }}
            </button>
          </div>
        </form>
      </div>

      <!-- Phase indicator -->
      <div class="phase-strip" :data-phase="currentPhase">
        <ol class="phase-steps" :aria-label="`Meet phase: ${phaseLabel(currentPhase)}`">
          <li
            v-for="(p, i) in MEET_PHASES"
            :key="p"
            class="phase-step"
            :class="{
              'is-past': i < phaseIdx,
              'is-current': i === phaseIdx,
            }"
            :title="phaseLabel(p)"
          >
            <span class="phase-step-dot" aria-hidden="true" />
          </li>
        </ol>
        <div class="phase-strip-label">
          <span class="phase-strip-name">{{ phaseLabel(currentPhase) }}</span>
          <span class="phase-strip-caption">phase</span>
        </div>
        <div v-if="isAdmin" class="phase-strip-actions">
          <button
            v-if="canRevertPhase"
            class="phase-link phase-link--quiet"
            :disabled="phaseSaving"
            :title="phaseRevertTitle"
            @click="advancePhase('revert')"
          >
            ← Revert
          </button>
          <button
            v-if="canAdvancePhase"
            class="phase-link phase-link--primary"
            :disabled="phaseSaving"
            :title="phaseAdvanceTitle"
            @click="advancePhase('advance')"
          >
            Advance to {{ phaseLabel(nextPhase!) }} →
          </button>
        </div>
      </div>
      <p v-if="phaseError" class="state-msg state-msg--error">{{ phaseError }}</p>

      <!-- Admin code -->
      <div v-if="isAdmin" class="section">
        <div class="section-header">
          <h3 class="section-title">Admin</h3>
        </div>
        <div class="item-list">
          <div class="item-row">
            <span class="item-name item-name--static">Admin code</span>
            <button
              class="code-btn"
              title="Manage admin code"
              @click="access?.openAdminCodeDialog()"
            >
              🔑
            </button>
          </div>
        </div>
      </div>

      <!-- Scoring template: the sheet rooms score in LibreOffice, and .ods downloads fill -->
      <div v-if="template || (isAdmin && currentPhase !== 'done')" class="section">
        <div class="section-header">
          <h3 class="section-title">Scoring template</h3>
          <div class="section-actions">
            <button v-if="template" class="btn btn--secondary btn--sm" @click="saveTemplate">
              ⤓ Download {{ template.fileName }}
            </button>
            <!-- A done meet's template stays as it is, as the API holds it -->
            <template v-if="isAdmin && currentPhase !== 'done'">
              <button
                class="btn btn--secondary btn--sm"
                :disabled="uploadingTemplate"
                @click="templateInput?.click()"
              >
                {{ uploadingTemplate ? 'Uploading…' : template ? '⤒ Replace' : '⤒ Upload' }}
              </button>
              <input
                ref="templateInput"
                type="file"
                accept=".ots,.ods"
                style="display: none"
                @change="onTemplatePicked"
              />
            </template>
          </div>
        </div>
        <p v-if="template && isAdmin" class="state-msg">
          Uploaded {{ template.uploadedAt.toLocaleString() }}
        </p>
        <p v-else-if="!template" class="state-msg">
          No template yet. Upload the meet's Scoresheet.ots so rooms can download it, and quizzes
          can be downloaded as spreadsheets.
        </p>
        <p v-if="templateError" class="field-error">{{ templateError }}</p>
      </div>

      <!-- Rooms -->
      <div class="section">
        <div class="section-header">
          <h3 class="section-title">Rooms</h3>
        </div>
        <p v-if="!detail.officialCodes.length && !isAdmin" class="state-msg">No rooms yet.</p>
        <ul v-if="detail.officialCodes.length" class="item-list">
          <li v-for="oc in detail.officialCodes" :key="oc.id" class="item-row">
            <span class="item-label">{{ oc.label }}</span>
            <span class="item-spacer"></span>
            <button
              v-if="isAdmin"
              class="code-btn"
              title="Manage room code"
              @click.stop="access?.openRoomCodeDialog(oc)"
            >
              🔑
            </button>
            <button
              v-if="isAdmin"
              class="row-btn row-btn--danger"
              @click.stop="handleDeleteRoom(oc.id)"
            >
              Delete
            </button>
          </li>
        </ul>
        <template v-if="isAdmin">
          <form v-if="showAddRoom" class="add-form" @submit.prevent="handleAddRoom">
            <input
              v-model="newRoomLabel"
              v-focus
              class="field-input"
              placeholder="Label (e.g. Room 1)"
              required
            />
            <div class="add-form-actions">
              <button type="submit" class="btn btn--primary btn--sm" :disabled="addingRoom">
                {{ addingRoom ? 'Adding…' : 'Add' }}
              </button>
              <button type="button" class="btn btn--ghost btn--sm" @click="showAddRoom = false">
                Cancel
              </button>
            </div>
            <p v-if="addRoomError" class="field-error">{{ addRoomError }}</p>
          </form>
          <button v-else class="dashed-add" @click="showAddRoom = true">+ Room</button>
        </template>
      </div>

      <!-- The meet's stats settings, with every division's steps (FR-019) -->
      <section v-if="isAdmin" id="stats" class="section">
        <StatsSettings />
      </section>

      <MeetAccessDialog ref="access" :meet-id="detail.meet.id" :is-superuser="isSuperuser" />
    </template>
  </div>
</template>

<style scoped>
.setup-tab {
  max-width: 52rem;
  margin: 0 auto;
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
  margin-bottom: 2rem;
}

.meet-info {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  flex: 1;
}

.meet-title-row {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.viewer-code-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.viewer-code {
  font-size: 0.75rem;
  color: var(--color-text-faint);
}

.viewer-code code {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.inline-icon-btn {
  background: none;
  border: none;
  padding: 0.15rem;
  cursor: pointer;
  color: var(--color-text-faint);
  border-radius: 3px;
  display: flex;
  align-items: center;
  opacity: 0;
  transition:
    opacity 0.1s,
    color 0.1s;
}

.viewer-code-row:hover .inline-icon-btn {
  opacity: 1;
}

.inline-icon-btn:hover {
  color: var(--color-accent);
  background: var(--color-bg-raised);
}

.icon-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-faint);
  border-radius: 4px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.icon-btn:hover {
  color: var(--color-text-muted);
  background: var(--color-bg-raised);
}

/* Edit card */
.edit-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 8px;
  padding: 1.25rem;
}

.edit-card-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-heading);
  margin: 0;
}

.edit-date-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-faint);
}

.field-hint {
  font-size: 0.7rem;
  font-weight: 400;
  color: var(--color-text-faint);
  opacity: 0.75;
}

.edit-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.field-input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.4rem 0.65rem;
  font-size: 0.875rem;
  color: var(--color-text);
  font-family: inherit;
  outline: none;
  min-width: 0;
  width: 100%;
}

.field-input:focus {
  border-color: var(--color-accent);
}

.field-error {
  font-size: 0.8rem;
  color: var(--palette-error);
  width: 100%;
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

/* Phase strip — compact lifecycle indicator + admin actions.
   Per-phase colour applies only to the current dot (and the Advance link),
   never as a banner background. */
.phase-strip {
  --phase-color: var(--color-text-faint);
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--color-border-alt);
  flex-wrap: wrap;
}

.phase-strip[data-phase='build'] {
  --phase-color: var(--palette-amber);
}
.phase-strip[data-phase='live'] {
  --phase-color: var(--palette-correct);
}
.phase-strip[data-phase='review'] {
  --phase-color: var(--palette-bonus);
}
.phase-strip[data-phase='done'] {
  --phase-color: var(--color-text-muted);
}

.phase-steps {
  display: flex;
  align-items: center;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  width: 6rem;
  flex-shrink: 0;
}

.phase-step {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: 0.75rem;
}

.phase-step::before,
.phase-step::after {
  content: '';
  position: absolute;
  top: 50%;
  height: 1px;
  width: 50%;
  background: var(--color-border-alt);
}
.phase-step::before {
  left: 0;
}
.phase-step::after {
  left: 50%;
}
.phase-step:first-child::before,
.phase-step:last-child::after {
  display: none;
}

.phase-step-dot {
  position: relative;
  z-index: 1;
  display: block;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--color-bg);
  box-shadow: 0 0 0 1px var(--color-border);
  transition: box-shadow 120ms ease;
}

.phase-step.is-past .phase-step-dot {
  background: var(--color-text-muted);
  box-shadow: 0 0 0 1px var(--color-text-muted);
}
.phase-step.is-past::before,
.phase-step.is-past::after,
.phase-step.is-current::before {
  background: var(--color-text-muted);
}

.phase-step.is-current .phase-step-dot {
  width: 0.6rem;
  height: 0.6rem;
  background: var(--phase-color);
  box-shadow:
    0 0 0 1px var(--phase-color),
    0 0 0 4px color-mix(in srgb, var(--phase-color) 18%, transparent);
}

/* Sized by its words, so on a narrow screen the actions wrap below instead of overlapping it */
.phase-strip-label {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  flex: 1 0 auto;
}

.phase-strip-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.phase-strip-caption {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  text-transform: lowercase;
  letter-spacing: 0.04em;
}

.phase-strip-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
}

.phase-link {
  background: none;
  border: none;
  padding: 0.15rem 0;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--color-text-muted);
  border-bottom: 1px solid transparent;
  transition:
    color 120ms ease,
    border-color 120ms ease;
}

.phase-link:hover:not(:disabled) {
  color: var(--color-text);
  border-bottom-color: currentColor;
}

.phase-link:disabled {
  opacity: 0.4;
  cursor: default;
}

.phase-link--primary {
  color: var(--phase-color);
  font-weight: 600;
}

.phase-link--primary:hover:not(:disabled) {
  color: var(--phase-color);
  filter: brightness(1.1);
  border-bottom-color: currentColor;
}

.phase-link--quiet {
  color: var(--color-text-faint);
}

/* Sections */
.section {
  margin-bottom: 2rem;
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
}

.section-actions {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

/* Item lists */
.item-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.875rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
}

.item-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  flex-shrink: 0;
}

.item-name {
  flex: 1;
  background: none;
  border: none;
  padding: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  cursor: default;
  text-align: left;
  font-family: inherit;
}

.item-name--static {
  cursor: default;
}

.item-spacer {
  flex: 1;
}

.row-btn {
  background: none;
  border: none;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  color: var(--color-accent);
  flex-shrink: 0;
}

.row-btn:hover {
  background: var(--color-bg);
}

.row-btn--danger {
  color: var(--palette-error);
}

.row-btn--danger:hover {
  background: var(--palette-error-alt, rgba(220, 38, 38, 0.08));
}

.code-btn {
  background: none;
  border: none;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  border-radius: 4px;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0.6;
  transition: opacity 0.1s;
}

.code-btn:hover {
  opacity: 1;
  background: var(--color-bg);
}

/* Add forms */
.add-form .field-input {
  width: auto;
}

.add-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

.add-form-actions {
  display: flex;
  gap: 0.35rem;
}

.dashed-add {
  width: 100%;
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  padding: 0.45rem;
  font-size: 0.75rem;
  color: var(--color-text-faint);
  cursor: pointer;
  font-family: inherit;
  text-align: center;
  margin-top: 0.5rem;
  transition:
    border-color 0.15s,
    color 0.15s;
}

.dashed-add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

/* Division tags */
.division-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}

.division-tags-label {
  font-size: 0.7rem;
  color: var(--color-text-faint);
  margin-right: 0.1rem;
}

.division-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.68rem;
  padding: 0.1rem 0.45rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 99px;
  color: var(--color-text-muted);
}

.division-tag--removable {
  padding-right: 0.25rem;
}

.division-remove {
  background: none;
  border: none;
  padding: 0 0.1rem;
  font-size: 0.78rem;
  line-height: 1;
  cursor: pointer;
  color: var(--color-text-faint);
  font-family: inherit;
}

.division-remove:hover {
  color: var(--palette-error);
}

.divisions-edit {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.division-add {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.division-add .field-input {
  max-width: 14rem;
  width: auto;
}
</style>
