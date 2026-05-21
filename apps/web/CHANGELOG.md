# Changelog — @qzr/web

All notable changes to the web portal (coach roster management, admin dashboard) are documented
here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Released via `.github/workflows/deploy-web.yml` (Cloudflare Pages, project `versevault-www`) on
every `version` bump in `apps/web/package.json` that lands on `master`. The same Pages project also
gets redeployed by `.github/workflows/release-scoresheet.yml` on scoresheet bumps — that workflow
rebuilds the bundled scoresheet PWA at `/scoresheet/` alongside whatever portal build is current.

The portal shipped as part of the unified monorepo versioning era under tags `v0.2.0`–`v0.9.1`; see
[`apps/scoresheet/CHANGELOG.md`](../scoresheet/CHANGELOG.md) for historical entries that covered the
portal. This per-package changelog starts fresh from 0.9.1 as the baseline.

## [Unreleased]

## [0.10.0] — 2026-05-21

First per-package web release. Covers everything shipped on master since unified tag `v0.9.1`.

### Added

* **Draft-and-save schedule editor** — `ScheduleEditView` now accumulates slot/quiz/seat edits,
  prelim assignments, and team lateness locally; **Save** commits the whole draft via the bulk
  `POST /schedule/sync` endpoint; **Discard** reverts to the last-saved snapshot. Mirrors the roster
  editor pattern in `MeetTeamsView`. Populate, Roll Teams, and Sort by Lateness now run instantly
  with no network round-trips
* **Unified Populate pipeline** — 4-layer pipeline (grid cell allocator → rule-book row sort by
  lateness → flexible per-slot division ownership → disjointness-aware row placement) replaces the
  ad-hoc populate logic. Drives the Populate button + the per-slot configuration
* **Per-team Late toggle in Prelim setup** — admins flag late teams; the populate pipeline pushes
  them to the back of the row order
* **Roll Teams** — generates letter→teamId prelim assignments locally as part of the draft
* **Stats break separator** — required slot kind that marks the prelim/elim boundary; Populate uses
  it to know where prelim quizzes end and elim quizzes begin
* **Per-division team counts in Prelim setup** — surfaces the new API field

### Changed

* `runPopulate` now mutates draft state only — no per-quiz API round-trips during
  populate/sort/roll; one bulk POST on Save
* Schedule grid splits view by day
* Prelim round-robin shape validation
* `d{div}-q{n|letter}` quiz label format for stable references across draft state

### Removed

* **Push-late button** — superseded by the per-slot Late toggle + populate pipeline. Bipartite
  matching and k-room push-late logic gone

### Bundled contract

* `@qzr/shared@0.9.2` — unchanged from 0.9.1
