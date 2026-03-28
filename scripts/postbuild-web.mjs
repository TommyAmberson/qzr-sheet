// Cloudflare Pages serves index.html before consulting _redirects for exact matches.
// Moving it to dist/scoresheet/ lets the / → /scoresheet redirect fire while still
// giving Pages a real file to serve at /scoresheet (and /scoresheet/*).
import { mkdirSync, renameSync } from 'node:fs'

mkdirSync('dist/scoresheet', { recursive: true })
renameSync('dist/index.html', 'dist/scoresheet/index.html')
console.log('Web build complete → dist/')
