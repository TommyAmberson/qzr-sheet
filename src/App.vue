<script setup lang="ts">
import Scoresheet from './components/Scoresheet.vue'
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>Quizmeet Scoresheet</h1>
    </header>
    <main>
      <Scoresheet />
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
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: #f5f0dc;
  color: #3a3518;
}

.app-header {
  padding: 0.75rem 1rem;
  background: #3a3518;
  color: #f5f0dc;
}

.app-header h1 {
  font-size: 1.1rem;
  font-weight: 600;
}
</style>
