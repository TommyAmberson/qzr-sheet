<script setup lang="ts">
import Scoresheet from './components/Scoresheet.vue'
import { useTheme } from './composables/useTheme'

const { theme, toggleTheme } = useTheme()

function onDownload() {
  // TODO Phase 2: serialize quiz state and trigger JSON file download
}

function onUpload() {
  // TODO Phase 2: open file picker and load JSON into store
}

function onNew() {
  // TODO Phase 2: confirm + reset store to defaults
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>Quizmeet Scoresheet</h1>
      <button
        class="theme-toggle"
        :title="`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`"
        @click="toggleTheme"
      >
        {{ theme === 'light' ? '🌙' : '☀️' }}
      </button>
    </header>
    <main>
      <Scoresheet @download="onDownload" @upload="onUpload" @new="onNew" />
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family:
    'Segoe UI',
    system-ui,
    -apple-system,
    sans-serif;
  background: var(--color-bg-warm);
  color: var(--color-text);
  transition:
    background 0.3s,
    color 0.3s;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: var(--color-text);
  color: var(--color-bg-warm);
  transition:
    background 0.3s,
    color 0.3s;
}

.app-header h1 {
  font-size: 1.1rem;
  font-weight: 600;
}

.theme-toggle {
  background: none;
  border: 1px solid var(--color-text-faint);
  border-radius: 6px;
  padding: 0.3rem 0.5rem;
  font-size: 1rem;
  cursor: pointer;
  line-height: 1;
  transition: background 0.15s;
}
.theme-toggle:hover {
  background: var(--color-border-alt);
}
</style>
