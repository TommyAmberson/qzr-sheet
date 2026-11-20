<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { MeetRole } from '@qzr/shared'

import {
  listMembers,
  revokeMember,
  rotateAdminCode,
  rotateChurchCoachCode,
  rotateOfficialCode,
  type Church,
  type MeetMember,
  type OfficialCode,
} from '../api'

/**
 * A meet's access code dialog: generating a new admin, coach or room code, shown once, and the
 * members who joined with it, whom an admin may remove. The Roster tab opens it for a church's
 * coaches, the Setup tab for the meet's admins and its rooms.
 */
const props = defineProps<{ meetId: number; isSuperuser: boolean }>()

interface AccessDialog {
  kind: 'admin' | 'church' | 'official'
  id?: number
  title: string
  description: string
  revealedCode: string | null
  busy: boolean
  members: MeetMember[]
  membersLoading: boolean
}
const accessDialog = ref<AccessDialog | null>(null)
// Only a superuser removes admins, whether one at a time or by clearing on rotate
const canRemoveMembers = computed(() => accessDialog.value?.kind !== 'admin' || props.isSuperuser)
const dialogRef = ref<HTMLDialogElement | null>(null)

function open(d: Omit<AccessDialog, 'busy' | 'members' | 'membersLoading'>) {
  accessDialog.value = { ...d, busy: false, members: [], membersLoading: false }
  nextTick(() => dialogRef.value?.showModal())
  // A code just created has no members yet
  if (!d.revealedCode) loadDialogMembers()
}

function closeAccessDialog() {
  dialogRef.value?.close()
  accessDialog.value = null
}

async function loadDialogMembers(d = accessDialog.value) {
  if (!d) return
  d.membersLoading = true
  const res = await listMembers(props.meetId).catch(() => null)
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
  open({
    kind: 'admin',
    title: 'Admin Access',
    description:
      'Share this code with other admins. Anyone who joins with it gets full management access to this meet.',
    revealedCode: null,
  })
}

function openChurchCodeDialog(
  ch: Pick<Church, 'id' | 'shortName'>,
  revealedCode: string | null = null,
) {
  open({
    kind: 'church',
    id: ch.id,
    title: `Coach Access — ${ch.shortName}`,
    description:
      'Share this code with the head coach. They can join the meet and manage their roster.',
    revealedCode,
  })
}

function openRoomCodeDialog(oc: OfficialCode, revealedCode: string | null = null) {
  open({
    kind: 'official',
    id: oc.id,
    title: `Room Access — ${oc.label}`,
    description: 'Share this code with the quizmaster or official for this room.',
    revealedCode,
  })
}

async function handleGenerateCode(clearMembers: boolean) {
  const d = accessDialog.value
  if (!d) return
  if (clearMembers && !confirm('Generate a new code and remove all current members?')) return
  d.busy = true
  d.revealedCode = null
  try {
    if (d.kind === 'admin') {
      const res = await rotateAdminCode(props.meetId, clearMembers)
      d.revealedCode = res.adminCode
    } else if (d.kind === 'church' && d.id) {
      const res = await rotateChurchCoachCode(d.id, clearMembers)
      d.revealedCode = res.coachCode
    } else if (d.kind === 'official' && d.id) {
      const res = await rotateOfficialCode(props.meetId, d.id, clearMembers)
      d.revealedCode = res.code
    }
    // Emptied at once, then read back from the server, which shows what the rotation actually
    // removed (an API not yet updated rotates only); a failed read keeps it empty
    if (clearMembers) d.members = []
    await loadDialogMembers(d)
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
  d.busy = true
  try {
    await revokeMember(props.meetId, member.userId, {
      role: member.role,
      churchId: member.churchId,
      officialCodeId: member.officialCodeId,
    })
    d.members = d.members.filter((m) => m.userId !== member.userId)
  } catch (e) {
    alert((e as Error).message)
  } finally {
    d.busy = false
  }
}

async function copyCode() {
  const code = accessDialog.value?.revealedCode
  if (code) await navigator.clipboard.writeText(code)
}

defineExpose({ openAdminCodeDialog, openChurchCodeDialog, openRoomCodeDialog })
</script>

<template>
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
        You won't see this code again, so copy it now. Lost it? Just generate a new one. This one
        then stops working: signed-in members keep their access, and guests who joined with it need
        the new code.
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
          v-if="canRemoveMembers"
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
              v-if="canRemoveMembers"
              class="row-btn row-btn--danger"
              :disabled="accessDialog.busy || accessDialog.membersLoading"
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

<style scoped>
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
