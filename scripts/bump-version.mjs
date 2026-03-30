#!/usr/bin/env node
/**
 * Bump the version in both package.json and src-tauri/tauri.conf.json.
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

bumpJson('package.json', (pkg) => (pkg.version = version))
bumpJson('src-tauri/tauri.conf.json', (cfg) => (cfg.version = version))

console.log(`\nVersion bumped to ${version}. Commit and tag:\n`)
console.log(`  git add package.json src-tauri/tauri.conf.json`)
console.log(`  git commit -m "chore: bump version to ${version}"`)
console.log(`  git tag v${version}`)
console.log(`  git push && git push --tags`)
