<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ScheduleSheet } from '@qzr/ui'

import TeamsSection from '../components/builder/TeamsSection.vue'
import { useScheduleBuilder } from '../composables/useScheduleBuilder'

const { doc, change, changeSettings, conflicts, issues, undo, redo, canUndo, canRedo } =
  useScheduleBuilder()

const problems = computed(() => conflicts.value.filter((c) => !c.warning).length)
const warnings = computed(() => conflicts.value.filter((c) => c.warning).length)
const tray = computed(() => doc.value.quizzes.filter((q) => !q.cell))

/** Step through the flagged quizzes, one at a time (FR-037) */
const flagged = computed(() => [...issues.value.keys()])
const step = ref(-1)
function nextIssue() {
  if (flagged.value.length === 0) return
  step.value = (step.value + 1) % flagged.value.length
  document
    .querySelector(`[data-quiz="${flagged.value[step.value]}"]`)
    ?.scrollIntoView({ block: 'center', inline: 'center' })
}

const SECTIONS = [
  { key: 'teams', title: 'Teams' },
  { key: 'frame', title: 'Time slots and rooms' },
  { key: 'prelims', title: 'Prelim settings' },
  { key: 'elims', title: 'Elim settings' },
] as const
type SectionKey = (typeof SECTIONS)[number]['key']

/** Only one section is open at a time (FR-004) */
const open = ref<SectionKey | null>('teams')
function toggle(key: SectionKey) {
  open.value = open.value === key ? null : key
}

function rename(event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  if (name && name !== doc.value.name) change((d) => (d.name = name))
}

function onKey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
  if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return
  event.preventDefault()
  if (event.shiftKey) redo()
  else undo()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="builder">
    <header class="builder-bar">
      <input class="schedule-name" :value="doc.name" aria-label="Schedule name" @change="rename" />
      <span class="spacer" />
      <button type="button" class="issue-count" :disabled="flagged.length === 0" @click="nextIssue">
        {{ problems }} {{ problems === 1 ? 'problem' : 'problems' }}, {{ warnings }}
        {{ warnings === 1 ? 'warning' : 'warnings' }}
      </button>
      <button type="button" :disabled="!canUndo" aria-label="Undo" @click="undo">Undo</button>
      <button type="button" :disabled="!canRedo" aria-label="Redo" @click="redo">Redo</button>
    </header>

    <div class="builder-main">
      <aside class="panel">
        <section v-for="s in SECTIONS" :key="s.key" class="panel-section" :data-section="s.key">
          <button
            type="button"
            class="section-head"
            :aria-expanded="open === s.key"
            @click="toggle(s.key)"
          >
            {{ s.title }}
          </button>
          <div v-if="open === s.key" class="section-body">
            <TeamsSection v-if="s.key === 'teams'" :doc="doc" @change="changeSettings" />
          </div>
        </section>
      </aside>

      <main class="grid-area">
        <p v-if="doc.settings.divisions.length === 0" class="empty">
          Enter each division's team count in Teams to build the schedule.
        </p>
        <ScheduleSheet v-if="doc.rooms.length > 0" :doc="doc" :issues="issues" />
        <section v-if="tray.length > 0" class="tray" aria-label="Unplaced quizzes">
          <h3>Unplaced</h3>
          <ul>
            <li v-for="q in tray" :key="q.id" :data-quiz="q.id">
              {{ q.label }}:
              {{ (issues.get(q.id) ?? []).map((c) => c.reason).join('; ') }}
            </li>
          </ul>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
.builder {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 4rem);
}

.builder-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border, #ddd);
}

.schedule-name {
  font: inherit;
  font-weight: 600;
  border: 1px solid transparent;
  background: transparent;
  padding: 0.25rem 0.5rem;
}

.schedule-name:hover,
.schedule-name:focus {
  border-color: var(--color-border, #ddd);
}

.spacer {
  flex: 1;
}

.builder-main {
  flex: 1;
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  min-height: 0;
}

.panel {
  border-right: 1px solid var(--color-border, #ddd);
  overflow-y: auto;
}

.section-head {
  width: 100%;
  text-align: left;
  font: inherit;
  font-weight: 600;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-border, #ddd);
  cursor: pointer;
}

.section-body {
  padding: 0.75rem 1rem;
}

.grid-area {
  overflow: auto;
  padding: 1rem;
}

.tray {
  margin-top: 1rem;
}

.empty {
  color: var(--color-text-muted, #666);
}
</style>
