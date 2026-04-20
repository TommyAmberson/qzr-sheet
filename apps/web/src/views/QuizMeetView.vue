<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { MeetRole } from '@qzr/shared'
import {
  getMeet,
  getMyMeets,
  updateMeet,
  listChurches,
  rotateAdminCode,
  createChurch,
  deleteChurch,
  updateChurch,
  rotateChurchCoachCode,
  createOfficialCode,
  deleteOfficialCode,
  rotateOfficialCode,
  importRoster,
  exportRoster,
  type MeetDetail,
  type MeetMembership,
  type Church,
  type OfficialCode,
  type MeetMember,
  listMembers,
  revokeMember,
} from '../api'
import { parseRosterCsv, serializeRosterCsv, type RosterEntry } from '../rosterCsv'
import { coachChurchIds as deriveCoachChurchIds } from '../meetAccess'

const props = defineProps<{ slug: string }>()
const router = useRouter()

const detail = ref<MeetDetail | null>(null)
const meetId = computed(() => detail.value?.meet.id ?? null)
const membership = ref<MeetMembership | null>(null)
const churches = ref<Church[]>([])
const loading = ref(true)
const error = ref('')

const role = computed(() => membership.value?.role ?? null)
const isSuperuser = computed(() => role.value === MeetRole.Superuser)
const isAdmin = computed(() => role.value === MeetRole.Admin || role.value === MeetRole.Superuser)

const myCoachChurchIds = ref<Set<number>>(new Set())

function canEditChurchName(churchId: number): boolean {
  if (isAdmin.value) return true
  return myCoachChurchIds.value.has(churchId)
}

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

// Add church
const showAddChurch = ref(false)
const newChurchForm = ref({ name: '', shortName: '' })
const addingChurch = ref(false)
const addChurchError = ref('')

// Edit church
const editingChurchId = ref<number | null>(null)
const editChurchForm = ref({ name: '', shortName: '' })
const savingChurch = ref(false)

// Add room
const showAddRoom = ref(false)
const newRoomLabel = ref('')
const addingRoom = ref(false)
const addRoomError = ref('')

// Access dialog
interface AccessDialog {
  kind: 'admin' | 'church' | 'official'
  id?: number
  title: string
  description: string
  hasClearOption: boolean
  revealedCode: string | null
  busy: boolean
  members: MeetMember[]
  membersLoading: boolean
}
const accessDialog = ref<AccessDialog | null>(null)
const dialogRef = ref<HTMLDialogElement | null>(null)

async function load() {
  try {
    const [detailRes, myMeetsRes] = await Promise.all([getMeet(props.slug), getMyMeets()])
    detail.value = detailRes
    const id = detailRes.meet.id
    membership.value = myMeetsRes.memberships.find((m) => m.meetId === id) ?? null
    if (!membership.value) {
      router.replace({ name: 'home' })
      return
    }
    myCoachChurchIds.value = deriveCoachChurchIds(myMeetsRes.memberships, id)
    const churchRes = await listChurches(id)
    churches.value = churchRes.churches
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function churchSummary(church: Church): string {
  const count = church.teamCount
  if (count === 0) return 'No teams'
  return count === 1 ? '1 team' : `${count} teams`
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
  const d = newDivision.value.trim()
  if (!d || editForm.value.divisions.includes(d)) return
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
    if (res.meet.viewerCode !== props.slug) {
      router.replace({ name: 'meet', params: { slug: res.meet.viewerCode } })
    }
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

// ---- Add church ----

async function handleAddChurch() {
  addChurchError.value = ''
  addingChurch.value = true
  try {
    const res = await createChurch(meetId.value!, newChurchForm.value)
    churches.value.push({ ...res.church, teamCount: 0 })
    newChurchForm.value = { name: '', shortName: '' }
    showAddChurch.value = false
    openAccessDialog({
      kind: 'church',
      id: res.church.id,
      title: `Coach Access — ${res.church.shortName}`,
      description:
        'Share this code with the head coach. They can join the meet and manage their roster.',
      hasClearOption: true,
      revealedCode: res.coachCode,
      busy: false,
      members: [],
      membersLoading: false,
    })
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

// ---- Add room ----

async function handleAddRoom() {
  addRoomError.value = ''
  addingRoom.value = true
  try {
    const res = await createOfficialCode(meetId.value!, newRoomLabel.value.trim())
    detail.value!.officialCodes.push(res.officialCode)
    newRoomLabel.value = ''
    showAddRoom.value = false
    openAccessDialog({
      kind: 'official',
      id: res.officialCode.id,
      title: `Room Access — ${res.officialCode.label}`,
      description: 'Share this code with the quizmaster or official for this room.',
      hasClearOption: false,
      revealedCode: res.code,
      busy: false,
      members: [],
      membersLoading: false,
    })
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

// ---- Access dialog ----

function openAccessDialog(d: AccessDialog) {
  accessDialog.value = d
  nextTick(() => dialogRef.value?.showModal())
  if (!d.revealedCode) loadDialogMembers()
}

function closeAccessDialog() {
  dialogRef.value?.close()
  accessDialog.value = null
}

async function loadDialogMembers() {
  const d = accessDialog.value
  if (!d) return
  d.membersLoading = true
  const res = await listMembers(meetId.value!).catch(() => null)
  if (res) {
    d.members = res.members.filter((m) => {
      if (d.kind === 'admin') return m.role === MeetRole.Admin
      if (d.kind === 'church') return m.role === MeetRole.HeadCoach && m.churchId === d.id
      if (d.kind === 'official') return m.role === MeetRole.Official && m.officialCodeId === d.id
      return false
    })
  }
  d.membersLoading = false
}

function openAdminCodeDialog() {
  openAccessDialog({
    kind: 'admin',
    title: 'Admin Access',
    description:
      'Share this code with other admins. Anyone who joins with it gets full management access to this meet.',
    hasClearOption: isSuperuser.value,
    revealedCode: null,
    busy: false,
    members: [],
    membersLoading: false,
  })
}

function openChurchCodeDialog(ch: Church) {
  openAccessDialog({
    kind: 'church',
    id: ch.id,
    title: `Coach Access — ${ch.shortName}`,
    description:
      'Share this code with the head coach. They can join the meet and manage their roster.',
    hasClearOption: true,
    revealedCode: null,
    busy: false,
    members: [],
    membersLoading: false,
  })
}

function openRoomCodeDialog(oc: OfficialCode) {
  openAccessDialog({
    kind: 'official',
    id: oc.id,
    title: `Room Access — ${oc.label}`,
    description: 'Share this code with the quizmaster or official for this room.',
    hasClearOption: false,
    revealedCode: null,
    busy: false,
    members: [],
    membersLoading: false,
  })
}

async function handleGenerateCode(clearMembers: boolean) {
  const d = accessDialog.value
  if (!d) return
  d.busy = true
  d.revealedCode = null
  try {
    if (d.kind === 'admin') {
      const res = await rotateAdminCode(meetId.value!, clearMembers)
      d.revealedCode = res.adminCode
    } else if (d.kind === 'church' && d.id) {
      const res = await rotateChurchCoachCode(d.id, clearMembers)
      d.revealedCode = res.coachCode
    } else if (d.kind === 'official' && d.id) {
      const res = await rotateOfficialCode(meetId.value!, d.id)
      d.revealedCode = res.code
    }
    if (clearMembers) d.members = []
    else await loadDialogMembers()
  } catch (e) {
    alert((e as Error).message)
  } finally {
    d.busy = false
  }
}

async function handleRevokeMember(member: MeetMember) {
  const d = accessDialog.value
  if (!d) return
  if (!confirm(`Remove ${member.name} (${member.email})?`)) return
  try {
    await revokeMember(meetId.value!, member.userId, {
      role: member.role,
      churchId: member.churchId,
      officialCodeId: member.officialCodeId,
    })
    d.members = d.members.filter((m) => m.userId !== member.userId)
  } catch (e) {
    alert((e as Error).message)
  }
}

async function copyCode() {
  const code = accessDialog.value?.revealedCode
  if (code) await navigator.clipboard.writeText(code)
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

// ---- Roster import / export ----

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
    await load()
  } catch (e) {
    importRosterError.value = (e as Error).message
  } finally {
    importingRoster.value = false
    if (rosterFileInput.value) rosterFileInput.value.value = ''
  }
}

async function applyRosterImport(entries: RosterEntry[]) {
  await importRoster(
    meetId.value!,
    entries.map((e) => ({
      church: e.church,
      division: e.division,
      teamName: e.teamName,
      quizzerName: e.quizzerName,
    })),
  )
}

async function handleExportRoster() {
  const res = await exportRoster(meetId.value!)
  const entries: RosterEntry[] = res.entries.map((e) => ({
    division: e.division,
    teamName: `${e.churchShortName} ${e.teamNumber}`,
    quizzerName: e.quizzerName,
    church: e.churchShortName,
  }))
  const csv = serializeRosterCsv(entries)
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${detail.value?.meet.name ?? 'roster'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'home' })">← QuizMeets</button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else-if="detail">
      <!-- Meet info -->
      <div class="page-header">
        <template v-if="!editing">
          <div class="meet-info">
            <div class="meet-title-row">
              <h2 class="page-title">{{ detail.meet.name }}</h2>
              <span class="meet-meta"
                >{{ detail.meet.dateFrom
                }}{{
                  detail.meet.dateTo && detail.meet.dateTo !== detail.meet.dateFrom
                    ? ` – ${detail.meet.dateTo}`
                    : ''
                }}</span
              >
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
                <input
                  v-model="newDivision"
                  class="field-input"
                  placeholder="Add division…"
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
            <input v-model="editForm.viewerCode" class="field-input" required />
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

      <!-- Admin code -->
      <div v-if="isAdmin" class="section">
        <div class="section-header">
          <h3 class="section-title">Admin</h3>
        </div>
        <div class="item-list">
          <div class="item-row">
            <span class="item-name item-name--static">Admin code</span>
            <button class="code-btn" title="Manage admin code" @click="openAdminCodeDialog">
              🔑
            </button>
          </div>
        </div>
      </div>

      <!-- Churches -->
      <div class="section">
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
                @click.stop="openChurchCodeDialog(c)"
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
              @click.stop="openRoomCodeDialog(oc)"
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

      <!-- Access management dialog -->
      <dialog ref="dialogRef" class="code-dialog" @close="accessDialog = null">
        <template v-if="accessDialog">
          <div class="dialog-header">
            <h3 class="dialog-title">{{ accessDialog.title }}</h3>
            <button class="dialog-close" @click="closeAccessDialog">&times;</button>
          </div>
          <p class="dialog-desc">{{ accessDialog.description }}</p>

          <div v-if="accessDialog.revealedCode" class="dialog-revealed">
            <code class="dialog-code">{{ accessDialog.revealedCode }}</code>
            <button class="btn btn--secondary btn--sm" @click="copyCode">Copy</button>
          </div>
          <p v-if="accessDialog.revealedCode" class="dialog-hint">
            This code is only shown now. Copy it before closing.
          </p>

          <div class="dialog-actions">
            <button
              class="btn btn--secondary"
              :disabled="accessDialog.busy"
              @click="handleGenerateCode(false)"
            >
              {{ accessDialog.busy ? '…' : 'Generate new code' }}
            </button>
            <button
              v-if="accessDialog.hasClearOption"
              class="btn btn--danger"
              :disabled="accessDialog.busy"
              @click="handleGenerateCode(true)"
            >
              Generate + remove all members
            </button>
          </div>
          <p class="dialog-footnote">Generating a new code invalidates the old one immediately.</p>

          <div class="dialog-members">
            <h4 class="dialog-members-title">Members</h4>
            <p v-if="accessDialog.membersLoading" class="state-msg">Loading…</p>
            <p v-else-if="accessDialog.members.length === 0" class="state-msg">No members yet.</p>
            <ul v-else class="member-list">
              <li v-for="m in accessDialog.members" :key="m.userId" class="member-row">
                <span class="member-name">{{ m.name }}</span>
                <span class="member-email">{{ m.email }}</span>
                <button
                  v-if="accessDialog.kind !== 'admin' || isSuperuser"
                  class="row-btn row-btn--danger"
                  @click="handleRevokeMember(m)"
                >
                  Revoke
                </button>
              </li>
            </ul>
          </div>
        </template>
      </dialog>
    </template>
  </div>
</template>

<style scoped>
.container {
  max-width: 52rem;
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
  margin-bottom: 2rem;
}

.meet-info {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  flex: 1;
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

.btn--danger {
  background: transparent;
  color: var(--palette-error);
  border-color: var(--palette-error);
}

.btn--danger:hover:not(:disabled) {
  background: var(--palette-error-alt, rgba(220, 38, 38, 0.08));
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
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

.item-sublabel {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--color-text-faint);
  flex: 1;
  min-width: 0;
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

/* Code dialog */
.code-dialog {
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 1.5rem;
  max-width: 26rem;
  width: calc(100vw - 3rem);
  margin: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

.code-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.dialog-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-heading);
}

.dialog-close {
  background: none;
  border: none;
  font-size: 1.2rem;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  line-height: 1;
  font-family: inherit;
}

.dialog-close:hover {
  color: var(--color-text-muted);
  background: var(--color-bg-raised);
}

.dialog-desc {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin-bottom: 1rem;
}

.dialog-revealed {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.5rem;
}

.dialog-code {
  flex: 1;
  font-family: monospace;
  font-size: 0.9rem;
  color: var(--color-text);
  word-break: break-all;
}

.dialog-hint {
  font-size: 0.72rem;
  color: var(--palette-warning, #b45309);
  margin-bottom: 1rem;
}

.dialog-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.dialog-actions .btn {
  justify-content: center;
}

.dialog-footnote {
  font-size: 0.72rem;
  color: var(--color-text-faint);
  line-height: 1.4;
}

.dialog-members {
  margin-top: 1.25rem;
  border-top: 1px solid var(--color-border-alt);
  padding-top: 0.875rem;
}

.dialog-members-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-faint);
  margin-bottom: 0.5rem;
}

.member-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--color-border-alt);
}

.member-row:last-child {
  border-bottom: none;
}

.member-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text);
}

.member-email {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
