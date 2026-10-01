#!/usr/bin/env node
/**
 * Bump the version of a single package in the monorepo.
 *
 * Usage:
 *   pnpm bump <pkg> <semver>
 *
 * Packages:
 *   scoresheet  → apps/scoresheet/package.json + apps/scoresheet/src-tauri/tauri.conf.json
 *   web         → apps/web/package.json
 *   api         → packages/api/package.json
 *   shared      → packages/shared/package.json
 *
 * Per-package versioning: a bump to `<pkg>` is the deploy trigger for that package's
 * workflow on master. No global tag — CI tags `<pkg>@<ver>` after successful deploy.
 */

import { readFileSync, writeFileSync } from 'fs'

const PACKAGES = {
  scoresheet: [
    'apps/scoresheet/package.json',
    'apps/scoresheet/src-tauri/tauri.conf.json',
  ],
  web: ['apps/web/package.json'],
  api: ['packages/api/package.json'],
  shared: ['packages/shared/package.json'],
}

const [pkg, version] = process.argv.slice(2)
const pkgList = Object.keys(PACKAGES).join(' | ')

if (!pkg || !version) {
  console.error(`Usage: pnpm bump <${pkgList}> <semver>  e.g. pnpm bump api 0.3.0`)
  process.exit(1)
}

if (!PACKAGES[pkg]) {
  console.error(`Unknown package: ${pkg}. Choose one of: ${pkgList}`)
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Invalid version: ${version}. Expected semver like 0.3.0 or 1.0.0-rc.1`)
  process.exit(1)
}

function bumpVersion(path, newVersion) {
  const obj = JSON.parse(readFileSync(path, 'utf8'))
  obj.version = newVersion
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n')
  console.log(`  ${path}  →  ${newVersion}`)
}

for (const path of PACKAGES[pkg]) {
  bumpVersion(path, version)
}

const files = PACKAGES[pkg].join(' ')

// A deployable's bump ships it once merged, so its commit says `release`. `shared` never deploys
// on its own; it is bumped once in the PR that changes it.
const subject = pkg === 'shared' ? `bump to ${version}` : `release ${version}`

console.log(`\n${pkg} bumped to ${version}. Commit on the PR's branch:\n`)
console.log(`  git add ${files}`)
console.log(`  git commit -m "chore(${pkg}): ${subject}"`)
if (pkg !== 'shared') {
  console.log(`\nMerging the PR to master deploys and tags ${pkg}@${version}.`)
}
