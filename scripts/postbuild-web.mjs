import { mkdirSync, renameSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

mkdirSync('dist/scoresheet', { recursive: true })

for (const entry of readdirSync('dist')) {
  if (entry !== '_redirects' && entry !== 'scoresheet') {
    renameSync(join('dist', entry), join('dist/scoresheet', entry))
  }
}

writeFileSync(
  'dist/index.html',
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0;url=/scoresheet" />
    <title>VerseVault</title>
  </head>
  <body></body>
</html>
`,
)

console.log('Web build complete → dist/')
