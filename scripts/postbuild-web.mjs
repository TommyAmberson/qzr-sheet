// Cloudflare Pages serves index.html directly before consulting _redirects,
// so we remove the root index.html to let the / → /scoresheet redirect rule fire.
import { unlinkSync } from 'node:fs'

unlinkSync('dist/index.html')
console.log('Web build complete → dist/')
