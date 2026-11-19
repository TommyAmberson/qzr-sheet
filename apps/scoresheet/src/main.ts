import { createApp } from 'vue'
import './assets/colors.css'
import { startTab } from './persistence/autoSave'

// The tab takes its own quiz before the sheet mounts, so the sheet starts with it in hand. Storage
// that fails to open must not keep the sheet from scoring: it mounts all the same, keeping nothing.
startTab()
  .catch((e: unknown) => console.error('Could not open the quiz records', e))
  .then(async () => {
    const { default: App } = await import('./App.vue')
    createApp(App).mount('#app')
  })
