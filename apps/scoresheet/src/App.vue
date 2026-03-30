<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Scoresheet from './components/Scoresheet.vue'

const scoresheetRef = ref<InstanceType<typeof Scoresheet> | null>(null)

function onDownload() {
  scoresheetRef.value?.saveFile()
}

function onUpload() {
  scoresheetRef.value?.openFile()
}

function onNew() {
  scoresheetRef.value?.newQuiz()
}

function onFileShortcut(event: KeyboardEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  if (event.key === 's' || event.key === 'S') {
    event.preventDefault()
    onDownload()
  } else if (event.key === 'o' || event.key === 'O') {
    event.preventDefault()
    onUpload()
  } else if (event.key === 'n' || event.key === 'N') {
    event.preventDefault()
    onNew()
  }
}

onMounted(() => document.addEventListener('keydown', onFileShortcut, { capture: true }))
onUnmounted(() => document.removeEventListener('keydown', onFileShortcut, { capture: true }))
</script>

<template>
  <div class="app">
    <Scoresheet ref="scoresheetRef" />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  height: 100%;
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

.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
}
</style>
