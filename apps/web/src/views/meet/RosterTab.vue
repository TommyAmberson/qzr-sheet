<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { teamDisplayName } from '@qzr/shared'

import {
  createChurch,
  deleteChurch,
  downloadTemplate,
  exportRoster,
  getTemplateInfo,
  importRoster,
  listChurches,
  updateChurch,
  type Church,
  type TemplateInfo,
} from '../../api'
import MeetAccessDialog from '../../components/MeetAccessDialog.vue'
import { saveFile } from '../../downloads'
import { useMeetPage } from '../../meetPage'
import { parseRosterCsv, serializeRosterCsv, type RosterEntry } from '../../rosterCsv'

/**
 * The Roster tab (FR-006): the meet's churches, each with its teams and quizzers, for whoever may
 * see them as today: admins manage them all and their coach codes, a church's coaches their own.
 */
const router = useRouter()
const { slug, meet, isAdmin, isSuperuser, coachChurchIds: myCoachChurchIds, beat } = useMeetPage()
const meetId = computed(() => meet.value?.id ?? 0)

const churches = ref<Church[]>([])
const loading = ref(true)
const error = ref('')
const access = ref<InstanceType<typeof MeetAccessDialog> | null>(null)

const showAddChurch = ref(false)
const newChurchForm = ref({ name: '', shortName: '' })
const addingChurch = ref(false)
const addChurchError = ref('')
const editingChurchId = ref<number | null>(null)
const editChurchForm = ref({ name: '', shortName: '' })
const savingChurch = ref(false)

function canEditChurchName(churchId: number): boolean {
  if (isAdmin.value) return true
  return myCoachChurchIds.value.has(churchId)
}

async function load() {
  const id = meet.value?.id
  if (id === undefined) return
  try {
    churches.value = (await listChurches(id)).churches
    error.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

// ---- Scoring template ----

/**
 * The meet's scoring template, which its officials and coaches download here; its admins keep it
 * in Setup, where they also replace it
 */
const template = ref<TemplateInfo | null>(null)
const templateError = ref('')

async function loadTemplate() {
  const id = meet.value?.id
  if (id === undefined || isAdmin.value) return
  template.value = await getTemplateInfo(id).catch(() => null)
}

async function saveTemplate() {
  templateError.value = ''
  try {
    const { bytes, fileName } = await downloadTemplate(meet.value!.id)
    saveFile(bytes, fileName, 'application/vnd.oasis.opendocument.spreadsheet-template')
  } catch (e) {
    templateError.value = (e as Error).message
  }
}

// The churches and the template, read on opening and for another meet
watch(
  () => meet.value?.id,
  () => {
    void load()
    void loadTemplate()
  },
  { immediate: true },
)

// Refresh, and the page's beat, read the churches again too
watch(beat, load)

function churchSummary(church: Church): string {
  const count = church.teamCount
  if (count === 0) return 'No teams'
  return count === 1 ? '1 team' : `${count} teams`
}

async function handleAddChurch() {
  addChurchError.value = ''
  addingChurch.value = true
  try {
    const res = await createChurch(meetId.value, newChurchForm.value)
    churches.value.push({ ...res.church, teamCount: 0 })
    newChurchForm.value = { name: '', shortName: '' }
    showAddChurch.value = false
    access.value?.openChurchCodeDialog(res.church, res.coachCode)
  } catch (e) {
    addChurchError.value = (e as Error).message
  } finally {
    addingChurch.value = false
  }
}

async function handleDeleteChurch(churchId: number) {
  const ch = churches.value.find((c) => c.id === churchId)
  if (!ch) return
  if (!confirm(`Delete ${ch.name}? This will remove all its teams, rosters, and coach access.`))
    return
  try {
    await deleteChurch(churchId)
    churches.value = churches.value.filter((c) => c.id !== churchId)
  } catch (e) {
    alert((e as Error).message)
  }
}

function startEditChurch(c: Church) {
  editingChurchId.value = c.id
  editChurchForm.value = { name: c.name, shortName: c.shortName === c.name ? '' : c.shortName }
}

function cancelEditChurch() {
  editingChurchId.value = null
}

async function saveEditChurch(churchId: number) {
  const name = editChurchForm.value.name.trim()
  if (!name) return
  savingChurch.value = true
  try {
    const data: { name: string; shortName?: string } = { name }
    const short = editChurchForm.value.shortName.trim()
    if (short) data.shortName = short
    else data.shortName = name
    const res = await updateChurch(churchId, data)
    const idx = churches.value.findIndex((c) => c.id === churchId)
    if (idx !== -1) churches.value[idx] = res.church
    editingChurchId.value = null
  } catch (e) {
    alert((e as Error).message)
  } finally {
    savingChurch.value = false
  }
}

const importingRoster = ref(false)
const importRosterError = ref('')
const rosterFileInput = ref<HTMLInputElement | null>(null)

function triggerRosterImport() {
  rosterFileInput.value?.click()
}

async function handleRosterFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importingRoster.value = true
  importRosterError.value = ''
  try {
    const text = await file.text()
    const entries = parseRosterCsv(text)
    if (entries.length === 0) {
      importRosterError.value = 'No roster entries found in file.'
      return
    }
    await applyRosterImport(entries)
  } catch (e) {
    importRosterError.value = (e as Error).message
  } finally {
    importingRoster.value = false
    if (rosterFileInput.value) rosterFileInput.value.value = ''
  }
  // Shown as the meet now has it, whatever the import did
  await load()
}

async function applyRosterImport(entries: RosterEntry[]) {
  await importRoster(
    meetId.value,
    entries.map((e) => ({
      church: e.church,
      division: e.division,
      teamName: e.teamName,
      quizzerName: e.quizzerName,
    })),
  )
}

async function handleExportRoster() {
  const res = await exportRoster(meetId.value)
  const entries: RosterEntry[] = res.entries.map((e) => ({
    division: e.division,
    teamName: teamDisplayName({ shortName: e.churchShortName, number: e.teamNumber }),
    quizzerName: e.quizzerName,
    church: e.churchShortName,
  }))
  saveFile(serializeRosterCsv(entries), `${meet.value?.name ?? 'roster'}.csv`, 'text/csv')
}
</script>

<template>
  <div class="roster-tab">
    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error && churches.length === 0" class="state-msg state-msg--error">
      {{ error }}
    </p>
    <template v-else>
      <!-- A background read that failed leaves the churches shown as they were -->
      <p v-if="error" class="state-msg state-msg--error">{{ error }}</p>
      <div id="churches" class="section">
        <div class="section-header">
          <h3 class="section-title">Churches</h3>
          <div v-if="isAdmin" class="section-actions">
            <button
              class="btn btn--secondary btn--sm"
              :disabled="importingRoster"
              @click="triggerRosterImport"
            >
              {{ importingRoster ? 'Importing…' : '⤒ Import Roster' }}
            </button>
            <button
              v-if="churches.length"
              class="btn btn--secondary btn--sm"
              @click="handleExportRoster"
            >
              ⤓ Export Roster
            </button>
            <input
              ref="rosterFileInput"
              type="file"
              accept=".csv,.tsv,.txt"
              style="display: none"
              @change="handleRosterFile"
            />
          </div>
        </div>
        <p v-if="importRosterError" class="field-error">{{ importRosterError }}</p>
        <p v-if="churches.length === 0 && !isAdmin" class="state-msg">No churches yet.</p>
        <ul v-if="churches.length" class="item-list">
          <li v-for="c in churches" :key="c.id" class="item-row">
            <template v-if="editingChurchId === c.id">
              <form class="church-edit-row" @submit.prevent="saveEditChurch(c.id)">
                <input
                  v-model="editChurchForm.name"
                  class="field-input"
                  placeholder="Full name"
                  required
                />
                <input
                  v-model="editChurchForm.shortName"
                  class="field-input field-input--short"
                  placeholder="Short (optional)"
                />
                <button type="submit" class="btn btn--primary btn--sm" :disabled="savingChurch">
                  {{ savingChurch ? '…' : 'Save' }}
                </button>
                <button type="button" class="btn btn--ghost btn--sm" @click="cancelEditChurch">
                  Cancel
                </button>
              </form>
            </template>
            <template v-else>
              <span class="church-name">
                <span class="church-name-full">{{ c.name }}</span>
                <span v-if="c.shortName !== c.name" class="church-name-short">
                  ({{ c.shortName }})
                </span>
                <button
                  v-if="canEditChurchName(c.id)"
                  class="church-pencil"
                  title="Edit church name"
                  @click.stop="startEditChurch(c)"
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
              </span>
              <span class="item-meta">{{ churchSummary(c) }}</span>
              <button
                v-if="isAdmin || myCoachChurchIds.has(c.id)"
                class="row-btn"
                @click="
                  router.push({
                    name: 'meet-church-teams',
                    params: { slug, churchId: c.id },
                  })
                "
              >
                Roster
              </button>
              <button
                v-if="isAdmin"
                class="code-btn"
                title="Manage coach code"
                @click.stop="access?.openChurchCodeDialog(c)"
              >
                🔑
              </button>
              <button
                v-if="isAdmin"
                class="row-btn row-btn--danger"
                @click.stop="handleDeleteChurch(c.id)"
              >
                Delete
              </button>
            </template>
          </li>
        </ul>
        <template v-if="isAdmin">
          <form v-if="showAddChurch" class="add-form" @submit.prevent="handleAddChurch">
            <input
              v-model="newChurchForm.name"
              class="field-input"
              placeholder="Full name (e.g. Grace Community Church)"
              required
            />
            <input
              v-model="newChurchForm.shortName"
              class="field-input field-input--short"
              placeholder="Short (e.g. GCC)"
            />
            <div class="add-form-actions">
              <button type="submit" class="btn btn--primary btn--sm" :disabled="addingChurch">
                {{ addingChurch ? 'Adding…' : 'Add' }}
              </button>
              <button type="button" class="btn btn--ghost btn--sm" @click="showAddChurch = false">
                Cancel
              </button>
            </div>
            <p v-if="addChurchError" class="field-error">{{ addChurchError }}</p>
          </form>
          <button v-else class="dashed-add" @click="showAddChurch = true">+ Church</button>
        </template>
      </div>

      <div v-if="template" class="section">
        <div class="section-header">
          <h3 class="section-title">Scoring template</h3>
          <div class="section-actions">
            <button class="btn btn--secondary btn--sm" @click="saveTemplate">
              ⤓ Download {{ template.fileName }}
            </button>
          </div>
        </div>
        <p v-if="templateError" class="field-error">{{ templateError }}</p>
      </div>
    </template>
    <MeetAccessDialog v-if="meet" ref="access" :meet-id="meet.id" :is-superuser="isSuperuser" />
  </div>
</template>

<style scoped>
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
.field-input--short {
  max-width: 7rem;
}
.field-input:focus {
  border-color: var(--color-accent);
}
.field-error {
  font-size: 0.8rem;
  color: var(--palette-error);
  width: 100%;
}
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
.item-meta {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  flex-shrink: 0;
}
.church-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  overflow: hidden;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
}
.church-name-full {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.church-name-short {
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--color-text-faint);
  margin-left: 0.3rem;
}
.church-pencil {
  background: none;
  border: none;
  padding: 0.15rem 0.25rem;
  color: var(--color-text-faint);
  cursor: pointer;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.1s;
}
.church-name:hover .church-pencil {
  opacity: 1;
}
.church-pencil:hover {
  color: var(--color-accent);
  background: var(--color-bg);
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
.add-form .field-input {
  width: auto;
}
.church-edit-row .field-input {
  width: auto;
}
.add-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}
.church-edit-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
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
</style>
