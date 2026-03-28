<script setup lang="ts">
import Scoresheet from './components/Scoresheet.vue'

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
    <Scoresheet @download="onDownload" @upload="onUpload" @new="onNew" />
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
</style>
