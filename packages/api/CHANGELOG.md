# Changelog — @qzr/api

All notable changes to the API (Hono + Drizzle on Cloudflare Workers, D1 database) are documented
here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Released via `.github/workflows/deploy-api.yml` (D1 migrations apply + `wrangler deploy`) on every
`version` bump in `packages/api/package.json` that lands on `master`.

The API shipped as part of the unified monorepo versioning era under tags `v0.2.0`–`v0.9.1`; see
[`apps/scoresheet/CHANGELOG.md`](../../apps/scoresheet/CHANGELOG.md) for historical entries that
covered API changes. This per-package changelog starts fresh from 0.9.1 as the baseline.

Each release section must include a `### Bundled contract` subsection naming the current
`@qzr/shared` version. A mismatch between the version named here and what consumers ship is a real
wire/state compatibility signal — see CLAUDE.md "Contract package versioning".

## [Unreleased]

## [0.11.0] — 2026-05-23

### Added

* **`quiz_results` + `quiz_disputes` tables** — immutable submission record with the QuizFile JSON,
  plus a flag/resolve loop for admins. `quiz_results.quizId` and `roomId` are nullable so orphan
  submissions (scoresheet not loaded from the schedule) succeed; SQLite NULL≠NULL semantics mean the
  (meetId, quizId) UNIQUE constraint only fires for scheduled submissions, returning 409.
* **`POST /api/meets/:id/results`** — first mutation route in the codebase that admits guest
  officials (via the new `isOfficialOf` helper). Validates the QuizFile against the shared TypeBox
  schema before insert. Stamps the submitter as either an account or a guest label.
* **`GET /api/meets/:id/results`** — admin/superuser list, newest first, with an `openDisputes`
  count per row for the future review UI.
* **`GET /api/meets/:id/results/:resultId`** — admin detail with the full QuizFile parsed back out
  of storage.
* **`POST /api/meets/:id/results/:resultId/disputes`** + **`PATCH /api/meets/:id/disputes/:id`** —
  flag-and-resolve dispute lifecycle. Officials raise; admins resolve. Resolved-state toggle stamps
  and clears the resolver attribution symmetrically.
* **`isOfficialOf(c, db, meetId)` permission helper** — superuser, meet admin, meet official, or
  guest-JWT official scoped to the meet. Composed inside the new submission and dispute routes.
* **`@sinclair/typebox` direct dependency** — needed for `Value.Check(QuizFileSchema, …)` so the API
  enforces the same schema the scoresheet serialises against.

### Bundled contract

* `@qzr/shared@0.9.2` — unchanged (the new endpoints consume the existing `QuizFileSchema`).

## [0.10.0] — 2026-05-21

First per-package API release. Covers everything shipped on master since unified tag `v0.9.1`.

### Added

* **Bulk `POST /api/meets/:id/schedule/sync` endpoint** — replaces the per-row schedule CRUD with a
  single full-state-replace request. Server diffs payload against current state, resolves tempId
  references between new slots and quizzes, full-replaces seats per editable quiz, full-replaces
  prelim assignments per division in payload, and per-team lateness diff. Rejects with 409 on
  attempts to delete or mutate completed quizzes. Mirrors the roster-sync pattern in
  `POST /api/churches/:churchId/roster/sync`
* **Team lateness flag** — `PATCH /api/teams/:teamId` accepts `lateness: boolean`; surfaces in the
  joined `GET /api/meets/:id/teams` rows
* **Roll Teams binding in prelim assignments** — server-side letter→teamId binding when populating
  prelim assignments
* **Per-division team counts** — `GET /api/meets/:id/teams` response includes per-division totals
  for the prelim setup UI

### Changed (breaking)

* **Removed per-row schedule endpoints** — `POST /meets/:id/slots`,
  `PATCH/DELETE /meets/:id/slots/:slotId`, `POST /meets/:id/quizzes`,
  `PATCH/DELETE /meets/:id/quizzes/:quizId`, `PATCH /meets/:id/quizzes/:quizId/seats`, and the
  standalone `POST /meets/:id/prelim-assignments` are gone. Clients must migrate to the bulk
  `POST /schedule/sync` endpoint. The web portal landed the migration in `@qzr/web@0.10.0`; any
  out-of-tree consumer needs the same change

### Bundled contract

* `@qzr/shared@0.9.2` — unchanged from 0.9.1 (no wire/schema changes; bump is the per-package
  baseline)
