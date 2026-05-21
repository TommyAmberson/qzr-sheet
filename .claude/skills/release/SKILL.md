---
name: release
description: >-
  Bump a single package's version, update its CHANGELOG, and commit. Use when the user says
  "release", "bump", "changelog bump", "cut a release", "tag a new version", or any variation
  of preparing a version bump with changelog updates for a specific package.
---

# Release

Prepare a per-package versioned release: scope the commit list to the package, suggest the bump
type, update that package's CHANGELOG, run the bump, and commit. CI deploys + tags `<pkg>@<ver>`
after the bump commit lands on master — never tag locally.

## Arguments

The user normally provides a package name (one of `scoresheet`, `web`, `api`, `shared`) and
optionally a version. If they only said "release", ask which package — but suggest the most likely
one based on which paths have unreleased commits.

## Steps

### 1. Check preconditions

Run `git status`. If there are uncommitted changes, warn the user and stop — releases should start
from a clean working tree on `master` (or a release branch).

### 2. Scope to the package

Find the last per-package tag:

```sh
git tag --sort=-v:refname --list '<pkg>@*' | head -1
```

If no per-package tag exists yet (the package is on its first per-package release after the
unified-tag era), fall back to the last `v*` tag.

Run, scoped to the package's paths:

```sh
git log --oneline <last-tag>..HEAD -- <package-paths>
```

Package path mapping:

* `scoresheet` → `apps/scoresheet/` (excluding `apps/scoresheet/CHANGELOG.md`)
* `web` → `apps/web/` (excluding `apps/web/CHANGELOG.md`)
* `api` → `packages/api/` (excluding `packages/api/CHANGELOG.md` and `.wrangler/`)
* `shared` → `packages/shared/`

Also read the current version from the package's `package.json`.

### 3. Decide the version bump

If the user provided a version, use that. Otherwise, suggest one based on the scoped commits:

* **patch** — bug fixes, small tweaks, infrastructure-only changes
* **minor** — new features, new UI, new file format versions, meaningful behavioural changes
* **major** — breaking changes to file format (non-backwards-compatible), API contract changes,
  major rewrites

For `shared`, MAJOR is reserved for wire/state contract breaks (consumers must adapt). See CLAUDE.md
"Contract package versioning".

Present the suggested version and a brief rationale. Ask the user to confirm or override before
proceeding.

### 4. Update the package's CHANGELOG

Read `<package>/CHANGELOG.md` and add a new section under `## [Unreleased]`:

```markdown
## [Unreleased]

## [<new-version>] — YYYY-MM-DD

### Added / Changed / Fixed / Infrastructure as appropriate

* …
```

Style rules:

* Group changes under `### Added`, `### Changed`, `### Fixed`, `### Infrastructure` as appropriate.
* Each entry is a bullet with a **bold label** followed by an em-dash and description.
* Wrap lines at 100 columns, with 2-space continuation indent.
* Only include user-facing or architecturally significant changes — skip pure chore commits.
* Look at actual code changes (not just commit messages) to write accurate, specific descriptions.
* Match the tone and detail level of existing entries in the file.

#### Extra step for `api`

After the regular sections, add a `### Bundled contract` subsection:

```markdown
### Bundled contract

* @qzr/shared@<current-shared-version> — <one-line note: changed since last release, or unchanged>
```

Read the current shared version from `packages/shared/package.json`. CI rejects api deploys where
the entry for the version being deployed doesn't reference the current shared version.

### 5. Bump the package version

Run:

```sh
pnpm bump <pkg> <new-version>
```

This updates only that package's `package.json` (and `tauri.conf.json` for `scoresheet`).

### 6. Commit

Stage the changes and commit:

```sh
git add <files-the-bump-script-reported> <package>/CHANGELOG.md
git commit -m "chore(<pkg>): bump to <new-version>"
```

The scope is required so commitlint matches.

### 7. Do not tag locally; do not push

CI tags `<pkg>@<new-version>` after a successful deploy on master. Let the user push when they're
ready — pushing fires the deploy.

## Rules

* Never add `Co-Authored-By` trailers to commits.
* Never push automatically — always let the user push.
* Keep changelog entries concise and audience-appropriate (scoresheet entries face end-users;
  api/web/shared entries face engineers).
* For `shared` bumps: every consumer that bundles shared (`api`, plus `web` and `scoresheet` if
  they're being bumped in the same window) must have their `### Bundled contract` subsection updated
  to name the new shared version when they next release. The deploy workflows enforce this at CI
  time.
