<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { generateSchedule, newScheduleDocument } from '@qzr/shared'

import {
  duplicateSchedule,
  forgetSchedule,
  keepSchedule,
  listSchedules,
  readScheduleFile,
  renameSchedule,
} from '../builder/persistence'

/** The schedules kept in this browser: open, rename, duplicate, delete, or start one (FR-002) */
const router = useRouter()
// A meet's linked draft is edited from its meet page, so it isn't listed here
const standalone = () => listSchedules().filter((s) => !s.linked)
const schedules = ref(standalone())
const message = ref('')
const refresh = () => (schedules.value = standalone())

function open(id: string) {
  void router.push({ name: 'builder-schedule', params: { id } })
}

function create() {
  const doc = generateSchedule(newScheduleDocument('New schedule'))
  if (!keepSchedule(doc)) {
    message.value = "This browser won't keep schedules, so save each one to a file."
  }
  open(doc.id)
}

function rename(id: string, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  if (!name) return
  renameSchedule(id, name)
  refresh()
}

function duplicate(id: string) {
  duplicateSchedule(id)
  refresh()
}

function remove(id: string) {
  forgetSchedule(id)
  refresh()
}

/** Open a schedule file; a newer or invalid one says why and changes nothing (FR-003) */
async function openFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const doc = await readScheduleFile(file)
    keepSchedule(doc)
    open(doc.id)
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div class="container builder-list">
    <h2>Schedules</h2>
    <p class="hint">
      Kept in this browser. Save one to a file to keep it safe or open it somewhere else.
    </p>
    <p v-if="message" class="message" role="status">{{ message }}</p>
    <div class="actions">
      <button type="button" class="primary" @click="create">New schedule</button>
      <label class="open-file">
        Open a file
        <input type="file" accept=".json" aria-label="Open a schedule file" @change="openFile" />
      </label>
    </div>
    <ul>
      <li v-for="s in schedules" :key="s.id" :data-schedule="s.id">
        <input :value="s.name" aria-label="Schedule name" @change="rename(s.id, $event)" />
        <button type="button" @click="open(s.id)">Open</button>
        <button type="button" @click="duplicate(s.id)">Duplicate</button>
        <button type="button" class="danger" @click="remove(s.id)">Delete</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.builder-list {
  display: grid;
  gap: 0.75rem;
}

.actions,
li {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.open-file input {
  margin-left: 0.5rem;
}

.message {
  color: var(--color-warn, #a60);
}

.danger {
  color: var(--color-danger, #c33);
}
</style>
