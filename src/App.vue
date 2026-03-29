<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Scoresheet from './components/Scoresheet.vue'

const scoresheetRef = ref<InstanceType<typeof Scoresheet> | null>(null)

function onFileShortcut(event: KeyboardEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  if (event.key === 's' || event.key === 'S') {
    event.preventDefault()
    scoresheetRef.value?.saveFile()
  } else if (event.key === 'o' || event.key === 'O') {
    event.preventDefault()
    scoresheetRef.value?.openFile()
  } else if (event.key === 'n' || event.key === 'N') {
    event.preventDefault()
    scoresheetRef.value?.newQuiz()
  }
}

onMounted(() => document.addEventListener('keydown', onFileShortcut, { capture: true }))
onUnmounted(() => document.removeEventListener('keydown', onFileShortcut, { capture: true }))
</script>

<template>
  <div class="app">
    <RouterView v-slot="{ Component }">
      <component :is="Component" ref="scoresheetRef" />
    </RouterView>
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
