<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  getMeet,
  rotateAdminCode,
  listChurches,
  createChurch,
  rotateChurchCoachCode,
  createOfficialCode,
  deleteOfficialCode,
  rotateOfficialCode,
  type Church,
  type OfficialCode,
} from '../api'

const props = defineProps<{ id: number }>()
const router = useRouter()

const meetName = ref('')
const churches = ref<Church[]>([])
const officialCodes = ref<OfficialCode[]>([])
const loading = ref(true)
const error = ref('')

const revealedCodes = ref<Record<string, string>>({})
const adminCodeBusy = ref(false)
const churchCodeBusy = ref<Record<number, boolean>>({})
const officialCodeBusy = ref<Record<number, boolean>>({})

const newOfficialLabel = ref('')
const addingOfficial = ref(false)
const addOfficialError = ref('')

const newChurchForm = ref({ name: '', shortName: '' })
const addingChurch = ref(false)
const addChurchError = ref('')

async function load() {
  try {
    const [meetRes, churchRes] = await Promise.all([getMeet(props.id), listChurches(props.id)])
    meetName.value = meetRes.meet.name
    officialCodes.value = meetRes.officialCodes
    churches.value = churchRes.churches
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function handleRotateAdminCode(clearMembers: boolean) {
  const msg = clearMembers
    ? 'Rotate the admin code and remove all current admins?'
    : 'Rotate the admin code? The old code will stop working immediately.'
  if (!confirm(msg)) return
  adminCodeBusy.value = true
  try {
    const res = await rotateAdminCode(props.id, clearMembers)
    revealedCodes.value['admin'] = res.adminCode
  } catch (e) {
    alert((e as Error).message)
  } finally {
    adminCodeBusy.value = false
  }
}

async function handleAddChurch() {
  addChurchError.value = ''
  addingChurch.value = true
  try {
    const res = await createChurch(props.id, newChurchForm.value)
    churches.value.push(res.church)
    revealedCodes.value[`church-${res.church.id}`] = res.coachCode
    newChurchForm.value = { name: '', shortName: '' }
  } catch (e) {
    addChurchError.value = (e as Error).message
  } finally {
    addingChurch.value = false
  }
}

async function handleRotateChurchCode(churchId: number, clearMembers: boolean) {
  const msg = clearMembers
    ? 'Rotate the coach code and remove all coaches for this church?'
    : 'Rotate this coach code? The old code will stop working immediately.'
  if (!confirm(msg)) return
  churchCodeBusy.value[churchId] = true
  try {
    const res = await rotateChurchCoachCode(churchId, clearMembers)
    revealedCodes.value[`church-${churchId}`] = res.coachCode
  } catch (e) {
    alert((e as Error).message)
  } finally {
    delete churchCodeBusy.value[churchId]
  }
}

async function handleAddOfficial() {
  addOfficialError.value = ''
  addingOfficial.value = true
  try {
    const res = await createOfficialCode(props.id, newOfficialLabel.value)
    officialCodes.value.push(res.officialCode)
    revealedCodes.value[`official-${res.officialCode.id}`] = res.code
    newOfficialLabel.value = ''
  } catch (e) {
    addOfficialError.value = (e as Error).message
  } finally {
    addingOfficial.value = false
  }
}

async function handleRotateOfficial(codeId: number) {
  if (!confirm('Rotate this code? The old code will stop working immediately.')) return
  officialCodeBusy.value[codeId] = true
  try {
    const res = await rotateOfficialCode(props.id, codeId)
    revealedCodes.value[`official-${res.officialCode.id}`] = res.code
  } catch (e) {
    alert((e as Error).message)
  } finally {
    delete officialCodeBusy.value[codeId]
  }
}

async function handleDeleteOfficial(codeId: number) {
  if (!confirm('Delete this official code?')) return
  try {
    await deleteOfficialCode(props.id, codeId)
    officialCodes.value = officialCodes.value.filter((c) => c.id !== codeId)
    delete revealedCodes.value[`official-${codeId}`]
  } catch (e) {
    alert((e as Error).message)
  }
}

onMounted(load)
</script>

<template>
  <div class="container">
    <button class="back-link" @click="router.push({ name: 'meet', params: { id } })">
      ← {{ meetName || 'QuizMeet' }}
    </button>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg state-msg--error">{{ error }}</p>

    <template v-else>
      <h2 class="page-title">Codes</h2>

      <!-- Admin code -->
      <div class="section">
        <h3 class="section-title">Admin</h3>
        <div class="code-row">
          <template v-if="revealedCodes['admin']">
            <code class="code-value code-value--revealed">{{ revealedCodes['admin'] }}</code>
          </template>
          <span v-else class="code-value code-value--hidden">••••••••</span>
          <button
            class="action-btn"
            :disabled="adminCodeBusy"
            @click="handleRotateAdminCode(false)"
          >
            {{ adminCodeBusy ? '…' : 'Rotate' }}
          </button>
          <button
            class="action-btn action-btn--danger"
            :disabled="adminCodeBusy"
            @click="handleRotateAdminCode(true)"
          >
            Rotate + clear
          </button>
        </div>
      </div>

      <!-- Church coach codes -->
      <div class="section">
        <h3 class="section-title">Churches</h3>

        <p v-if="churches.length === 0" class="state-msg">No churches yet.</p>
        <ul v-else class="code-list">
          <li v-for="ch in churches" :key="ch.id" class="code-row">
            <span class="code-label">{{ ch.shortName }}</span>
            <span class="code-sublabel">{{ ch.name }}</span>
            <template v-if="revealedCodes[`church-${ch.id}`]">
              <code class="code-value code-value--revealed">{{
                revealedCodes[`church-${ch.id}`]
              }}</code>
            </template>
            <span v-else class="code-value code-value--hidden">••••••••</span>
            <button
              class="action-btn"
              :disabled="churchCodeBusy[ch.id]"
              @click="handleRotateChurchCode(ch.id, false)"
            >
              {{ churchCodeBusy[ch.id] ? '…' : 'Rotate' }}
            </button>
            <button
              class="action-btn action-btn--danger"
              :disabled="churchCodeBusy[ch.id]"
              @click="handleRotateChurchCode(ch.id, true)"
            >
              Rotate + clear
            </button>
          </li>
        </ul>

        <form class="add-form" @submit.prevent="handleAddChurch">
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
            required
          />
          <button type="submit" class="btn btn--secondary" :disabled="addingChurch">
            {{ addingChurch ? 'Adding…' : 'Add church' }}
          </button>
          <p v-if="addChurchError" class="field-error">{{ addChurchError }}</p>
        </form>
      </div>

      <!-- Official codes -->
      <div class="section">
        <h3 class="section-title">Official codes</h3>

        <p v-if="officialCodes.length === 0" class="state-msg">No official codes yet.</p>
        <ul v-else class="code-list">
          <li v-for="oc in officialCodes" :key="oc.id" class="code-row">
            <span class="code-label">{{ oc.label }}</span>
            <template v-if="revealedCodes[`official-${oc.id}`]">
              <code class="code-value code-value--revealed">{{
                revealedCodes[`official-${oc.id}`]
              }}</code>
            </template>
            <span v-else class="code-value code-value--hidden">••••••••</span>
            <button
              class="action-btn"
              :disabled="officialCodeBusy[oc.id]"
              @click="handleRotateOfficial(oc.id)"
            >
              {{ officialCodeBusy[oc.id] ? '…' : 'Rotate' }}
            </button>
            <button class="action-btn action-btn--danger" @click="handleDeleteOfficial(oc.id)">
              Delete
            </button>
          </li>
        </ul>

        <form class="add-form" @submit.prevent="handleAddOfficial">
          <input
            v-model="newOfficialLabel"
            class="field-input"
            placeholder="Label (e.g. Room 1)"
            required
          />
          <button type="submit" class="btn btn--secondary" :disabled="addingOfficial">
            {{ addingOfficial ? 'Adding…' : 'Add code' }}
          </button>
          <p v-if="addOfficialError" class="field-error">{{ addOfficialError }}</p>
        </form>
      </div>
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

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 1.5rem;
}

.section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-bottom: 0.75rem;
}

.code-list {
  list-style: none;
}

.code-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--color-border-alt);
}

.code-row:last-child {
  border-bottom: none;
}

.code-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-muted);
  min-width: 4rem;
  flex-shrink: 0;
}

.code-sublabel {
  font-size: 0.8rem;
  color: var(--color-text-faint);
  flex: 1;
}

.code-value {
  font-family: monospace;
  font-size: 0.875rem;
  flex: 1;
}

.code-value--revealed {
  color: var(--color-text);
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-alt);
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  word-break: break-all;
}

.code-value--hidden {
  color: var(--color-text-faint);
  letter-spacing: 0.1em;
}

.action-btn {
  background: none;
  border: none;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
  padding: 0.2rem 0.45rem;
  border-radius: 4px;
  color: var(--color-text-faint);
}

.action-btn:hover:not(:disabled) {
  color: var(--color-text-muted);
  background: var(--color-bg-raised);
}

.action-btn--danger {
  color: var(--palette-error);
}

.action-btn--danger:hover:not(:disabled) {
  background: var(--palette-error-alt);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.add-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.875rem;
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
  min-width: 0;
}

.field-input:focus {
  border-color: var(--color-accent);
}

.field-input--short {
  max-width: 7rem;
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
  font-size: 0.875rem;
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
</style>
