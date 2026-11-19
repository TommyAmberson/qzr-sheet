import { createApp } from 'vue'
import './assets/colors.css'
import { startTab } from './persistence/autoSave'
import { portalLink } from './portalLink'

// The tab takes its own quiz before the sheet mounts, so the sheet starts with it in hand. Storage
// that fails to open must not keep the sheet from scoring: it mounts all the same, keeping nothing.
// A tab opened by a portal link opens what it names, so it offers no quiz left behind.
startTab({ byLink: portalLink(location.search) !== null })
  .catch((e: unknown) => console.error('Could not open the quiz records', e))
  .then(async () => {
    // Loaded only now: the meet session's module reads the tab's link as it loads
    const { default: App } = await import('./App.vue')
    createApp(App).mount('#app')
  })
