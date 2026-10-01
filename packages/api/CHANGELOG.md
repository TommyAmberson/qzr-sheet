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
wire/state compatibility signal — see CONTRIBUTING.md "Contract package versioning".

## [Unreleased]

## [0.12.0] - 2026-10-01

### Added

* **Served at `/qzr/api/*`** - every route answers under `/qzr/api/` as well as `/api/`, ahead of
  qzr moving under `/qzr/` so verse-vault can take the root. Better Auth picks its base path per
  request (`/qzr/api/auth` or `/api/auth`), so OAuth callbacks return to the address sign-in started
  on. The root `/api/*` route stays until switch day

### Changed

* **Session cookies use the `qzr` prefix** - `__Secure-qzr.session_token` and friends instead of
  Better Auth's default `better-auth.` names, which verse-vault also uses on the same host. Each app
  was overwriting the other's session. Existing qzr sessions are not read after this, so everyone
  signs in once more

### Bundled contract

* `@qzr/shared@0.9.2` - unchanged since api 0.10.0

## [0.11.0] - 2026-10-01

### Added

* **`GET /api/meets/:id/quizzes/:quizId/teams`** - one scheduled quiz with its 3 seats resolved to
  teams (via `prelim_assignments` or `seed_resolutions`) and their rosters, in one request.
  Unresolved seats return `team: null` and `quizzers: []`. Backs the scoresheet's load-from-schedule
  flow

### Fixed

* **Schedule reads gated per meet** - `GET /api/meets/:id/rooms`, `/slots`, `/quizzes`,
  `/prelim-assignments`, and the new quiz-teams route now require membership of that meet (any role)
  or superuser, and return 403 to anyone else. Previously any signed-in account could read any
  meet's schedule
* **Schedule sync on full-sized meets** - `POST /api/meets/:id/schedule/sync` chunks its slot, quiz,
  seat, and prelim-assignment inserts to stay under D1's 100 bound-parameter cap. A full-meet
  Populate, or a division of 20+ teams, failed with `too many SQL variables`

### Bundled contract

* `@qzr/shared@0.9.2` - unchanged since api 0.10.0

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
