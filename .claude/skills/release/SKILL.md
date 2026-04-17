---
name: release
description: >-
  Bump version, update changelog, commit, and tag for a new release. Use when the user says
  "release", "bump", "changelog bump", "cut a release", "tag a new version", or any variation
  of preparing a version bump with changelog updates.
---

# Release

Prepare a versioned release: determine the version bump, update the changelog, bump all package
files, commit, and tag.

## Steps

### 1. Check preconditions

Run `git status`. If there are uncommitted changes, warn the user and stop — releases should start
from a clean working tree.

### 2. Determine what changed

Find the last release tag: `git tag --sort=-v:refname | head -1`

Run `git log --oneline <last-tag>..HEAD` to see all commits since the last release. Read the current
version from `package.json`.

### 3. Decide the version bump

If the user provided a version or bump type, use that. Otherwise, suggest one based on the commits:

* **patch** — bug fixes, small tweaks, infrastructure-only changes
* **minor** — new features, new UI, new file format versions, meaningful behavioral changes
* **major** — breaking changes to file format (non-backwards-compatible), API contract changes,
  major rewrites

Present the suggested version and a brief rationale. Ask the user to confirm or override before
proceeding.

### 4. Update the changelog

Read `CHANGELOG.md` and add a new section at the top (below `# Changelog`) following the existing
style exactly:

* Group changes under `### Added`, `### Changed`, `### Fixed`, `### Infrastructure` as appropriate
* Each entry is a bullet with a **bold label** followed by an em-dash and description
* Wrap lines at 100 columns, with 2-space continuation indent
* Only include user-facing or architecturally significant changes — skip pure chore commits
* Look at actual code changes (not just commit messages) to write accurate, specific descriptions
* Match the tone and detail level of existing entries

### 5. Bump version files

Run: `pnpm bump <version>`

This updates all package.json files and tauri.conf.json.

### 6. Commit and tag

Stage all changed files and commit:

```
chore: bump version to <version>
```

Then tag: `git tag v<version>`

Do NOT push — let the user decide when to push.

## Rules

* Never add `Co-Authored-By` trailers to commits.
* Never push automatically — always let the user push.
* Keep changelog entries concise and user-facing.
