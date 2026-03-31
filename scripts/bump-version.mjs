#!/usr/bin/env node
/**
 * Bump the version across all versioned files in the monorepo.
 *
 * Usage:
 *   node scripts/bump-version.mjs 1.2.3
 */

import { readFileSync, writeFileSync } from 'fs'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/bump-version.mjs <semver>  e.g. 1.2.3')
  process.exit(1)
}

function bumpJson(path, updater) {
  const obj = JSON.parse(readFileSync(path, 'utf8'))
  updater(obj)
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n')
  console.log(`  ${path}  →  ${version}`)
}

function bumpToml(path, key) {
  const content = readFileSync(path, 'utf8')
  const updated = content.replace(
    new RegExp(`^(${key}\\s*=\\s*)"[^"]+"`, 'm'),
    `$1"${version}"`,
  )
  writeFileSync(path, updated)
  console.log(`  ${path}  →  ${version}`)
}

bumpJson('package.json', (pkg) => (pkg.version = version))
bumpJson('apps/scoresheet/package.json', (pkg) => (pkg.version = version))
bumpToml('apps/scoresheet/src-tauri/tauri.conf.json', 'version')

console.log(`\nVersion bumped to ${version}. Commit and tag:\n`)
console.log(`  git add package.json apps/scoresheet/package.json apps/scoresheet/src-tauri/tauri.conf.json`)
console.log(`  git commit -m "chore: bump version to ${version}"`)
console.log(`  git tag v${version}`)
console.log(`  git push && git push --tags`)

