<script setup lang="ts">
import '../builder/builder.css'
import { ref } from 'vue'
import { formatWhen } from '@qzr/ui'
import { useRouter } from 'vue-router'
import { generateSchedule, newScheduleDocument } from '@qzr/shared'

import {
  duplicateSchedule,
  forgetSchedule,
  keepSchedule,
  listSchedules,
  loadSchedule,
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
  // One this browser won't keep still opens; the builder says to save it to a file
  keepSchedule(doc)
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
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Cleared, so picking the same file again (after freeing storage, say) still opens it
  input.value = ''
  if (!file) return
  try {
    let doc = await readScheduleFile(file)
    // A file saved from a meet's schedule opens as a schedule of its own, apart from the meet's draft
    if (doc.link) {
      doc = { ...doc, id: crypto.randomUUID() }
      delete doc.link
    }
    // A schedule kept here already isn't replaced by its file: the file opens beside it
    const kept = loadSchedule(doc.id)
    if (kept && JSON.stringify(kept) !== JSON.stringify(doc)) {
      doc = { ...doc, id: crypto.randomUUID(), name: `${doc.name} (from file)` }
    }
    // One this browser won't keep still opens, for as long as the page is open; the builder says
    // to save it to a file
    keepSchedule(doc)
    open(doc.id)
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div class="builder-list">
    <header class="list-head">
      <div>
        <h2>Schedules</h2>
        <p class="hint">
          Kept in this browser. Save one to a file to keep it safe or open it somewhere else.
        </p>
      </div>
      <div class="actions">
        <label class="open-file">
          ⤒ Open a file
          <input type="file" accept=".json" aria-label="Open a schedule file" @change="openFile" />
        </label>
        <button type="button" class="primary" @click="create">✦ New schedule</button>
      </div>
    </header>
    <p v-if="message" class="message" role="status">{{ message }}</p>
    <p v-if="schedules.length === 0" class="empty">
      No schedules in this browser yet. Start one, or open a schedule file.
    </p>
    <ul v-else>
      <li v-for="s in schedules" :key="s.id" :data-schedule="s.id">
        <input
          class="name"
          :value="s.name"
          aria-label="Schedule name"
          @change="rename(s.id, $event)"
        />
        <span class="saved">Saved {{ formatWhen(s.savedAt) }}</span>
        <button type="button" class="primary" @click="open(s.id)">Open</button>
        <button type="button" @click="duplicate(s.id)">Duplicate</button>
        <button type="button" class="danger" @click="remove(s.id)">Delete</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.builder-list {
  display: grid;
  gap: 1rem;
  max-width: 56rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.list-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

/* The file input hides behind a label drawn as a button */
.open-file {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--color-meta-accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-meta-accent) 20%, transparent);
  color: var(--color-text-muted);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.open-file:hover {
  border-color: var(--color-text-faint);
  background: var(--color-border-alt);
  color: var(--color-text);
}

.open-file:focus-within {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.open-file input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

ul {
  list-style: none;
  display: grid;
  gap: 0.5rem;
}

/* Each schedule a row like the scoresheet's toolbar */
li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem 0.5rem 0.75rem;
  border: 1px solid var(--color-meta-accent);
  border-left: 3px solid var(--color-meta-border);
  border-radius: 6px;
  background: var(--color-meta-bg);
}

li .name {
  flex: 1;
  min-width: 10rem;
  border-color: transparent;
  background: transparent;
  color: var(--color-heading);
  font-size: 0.95rem;
  font-weight: 650;
}

li .name:hover {
  border-color: var(--color-meta-accent);
}

.saved {
  margin-right: 0.5rem;
  color: var(--color-text-faint);
  font-size: 0.78rem;
}

.empty {
  padding: 2rem;
  border: 1px dashed var(--color-meta-accent);
  border-radius: 6px;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
