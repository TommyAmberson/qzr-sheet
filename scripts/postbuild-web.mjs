// Vite builds into dist/ but the app is served at /scoresheet.
// Move all build output into dist/scoresheet/ so asset URLs match the base path.
// _redirects and index.html stay at the root: Pages serves index.html for /
// (which meta-refreshes to /scoresheet) and _redirects handles SPA routing.
import { mkdirSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const KEEP_AT_ROOT = new Set(['_redirects', 'index.html', 'scoresheet'])

mkdirSync('dist/scoresheet', { recursive: true })

for (const entry of readdirSync('dist')) {
  if (!KEEP_AT_ROOT.has(entry)) {
    renameSync(join('dist', entry), join('dist/scoresheet', entry))
  }
}

console.log('Web build complete → dist/')
