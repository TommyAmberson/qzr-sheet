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

## [0.18.0] - 2026-10-04

### Added

* **Team names** - a meet may keep team names per division (migration `0007`, table
  `meet_team_names`) for its scoresheets to offer. `GET /api/meets/:id/team-names` gives them, in
  the order given, to anyone who may view the meet; `PUT` replaces them, for admins, as one change.
  Names are tidied and blank ones dropped; a division listed twice, or a name listed twice in its
  division ignoring case and spaces, is a 400

### Bundled contract

* `@qzr/shared@1.5.0` - bumped from 1.4.0

## [0.17.0] - 2026-10-02

### Added

* **History and restore** - `GET /api/meets/:id/results/:resultId/revisions` lists a stored quiz's
  saves, each with its file and whether it shows the current content, and its counting records,
  newest first, with who, when and how; `GET .../revisions/:revision` gives one revision's file for
  the scoresheet, a restoring revision giving the file it restores; `POST .../restore` makes an
  earlier revision current again by adding a revision that restores it, moving the quiz back to that
  content's name, and adds nothing when that content is already current
* **Officials' corrections** - an official of a room a quiz already has may read its history, edit
  it with `PUT`, and restore it, each change recorded for one of their rooms the quiz already has

### Changed

* Revision and counting times are kept to the millisecond (migration `0006` converts older rows), so
  a quiz's history orders changes made close together
* `PUT` changes a quiz's name and adds its revision together, in one D1 batch, so a failed save
  can't leave a quiz renamed but unchanged; a name taken by another quiz in the meantime is a 409,
  not a 500

### Bundled contract

* `@qzr/shared@1.4.0` - bumped from 1.3.0

## [0.16.0] - 2026-10-02

### Added

* **Uploads and rooms** - `POST /api/meets/:id/results` takes `upload: true` for a saved file sent
  without being opened, recorded as `uploaded`. A meet admin may send a quiz for any room of the
  meet, recorded as from that room ("Pat, Room 2"), or for none, recorded as their own edit
* **Officials' quizzes** - `GET /api/meets/:id/results` lets an official list the quizzes their
  rooms have saved; a quiz belongs to every room a revision of it was saved for, so saving another
  room's quiz name adds it. A signed-in official of several rooms sees all of theirs
* **Who may send** - `GET /api/meets/:id/results/sender` tells the caller whether they're an admin
  and which rooms they may send for, so the scoresheet and portal don't work it out themselves

### Bundled contract

* `@qzr/shared@1.3.0` - unchanged

## [0.15.0] - 2026-10-02

### Added

* **Counting quizzes** - `PATCH /api/meets/:id/results/counted` lets a meet's admins count or
  uncount several of its quizzes at once, for the standings. Each change is recorded with who made
  it and when; a quiz whose value doesn't change gets no record, and an id outside the meet changes
  nothing (404)

### Changed

* Whether a stored quiz counts is now its newest counting record rather than a column of its own
  (migration `0005` drops `quiz_results.counted` and indexes the records by quiz), so a quiz and its
  record can't disagree. Large changes are written in chunks that fit D1's parameter limit. Nothing
  was counted before this release
* Quiz names are folded with `@qzr/shared`'s `foldName`, the rule the standings use for team names,
  and named with its `quizName`
* `GET /api/meets/:id/results` gives each quiz's `origin`, its first revision's action and saver,
  instead of `roomId` and `roomName`, so a quiz whose room was deleted still says where it came from
  (#104)

### Bundled contract

* `@qzr/shared@1.3.0` - bumped from 1.2.0

## [0.14.0] - 2026-10-02

### Added

* **Meet results** - `POST /api/meets/:id/results` stores a quiz an official submits from their
  room, or a quiz file an admin uploads. A quiz is known by its name (division, consolation and quiz
  number, ignoring case and spaces): a name the meet already has gets 409 with the stored quiz's
  current revision, and when sent again with `onExisting` is saved as the new current revision
  (`newRevision`) or saved while keeping the current one (`keepCurrent`, which adds a revision
  restoring it). A revision carries a quiz file or restores an earlier one, so nothing is copied and
  the newest revision is always current. `PUT /api/meets/:id/results/:resultId` lets admins edit a
  stored quiz, refusing a rename onto another quiz's name; `GET /api/meets/:id/results` lists the
  meet's quizzes for its admins. Every save is kept as a revision with who saved it, when and how.
  Files are checked as the scoresheet reads them, with no loose values, and a file from a newer
  scoresheet is refused with 422
* **Room on official guest tokens** - an official's guest token now names its room, so a submission
  is recorded against it, and is tied to the room's current code, so rotating the code or deleting
  the room revokes it. Officials holding a token from before this change are asked to rejoin
* **Official's room in `GET /api/my-meets`** - official memberships now include `roomId`, so a
  signed-in official's scoresheet can submit for its room

### Bundled contract

* `@qzr/shared@1.2.0` - bumped from 1.1.0

## [0.13.0] - 2026-10-02

Switch day: verse-vault takes the root of www.versevault.ca.

### Removed

* **The public `/api/*` route** - the Worker answers only under `www.versevault.ca/qzr/api/*`, and
  verse-vault's router takes `/api/*`. App builds before 0.11.0 (which call `/api/...`) lose their
  connected features; scoring is unaffected. The root mount stays in the code for local dev and the
  tests. The root `/api/auth/callback/{github,google}` URLs can come out of the OAuth providers

### Bundled contract

* `@qzr/shared@1.1.0` - bumped from 0.9.2. The API code doesn't change with it: the newer shared
  versions add the social sign-in error helper, 15-question quiz formats, and the scoring and
  quiz-file functions moved out of the scoresheet, none of which this release calls

## [0.12.2] - 2026-10-01

### Fixed

* **Meet admins confined to their own meet** - routes scoped to one meet acted on child rows from
  any meet when given a foreign ID. An admin of one meet could rotate another meet's official code
  (and use the returned code to join as its official) or delete another meet's room, cascading to
  its scheduled quizzes, via `POST/DELETE /api/meets/:id/official-codes/:codeId`, and remove a
  coach's membership in another meet via `DELETE /api/meets/:id/members/:userId`. Each now matches
  the child row against the meet in the URL and returns 404 otherwise
* **Admin code kept on a refused clear** - `POST /api/meets/:id/rotate-admin-code` with
  `clearMembers` from a non-superuser rotated the code before refusing with 403, so the new code was
  never shown. It now refuses first and changes nothing
* **Schedule sync confined to its meet** - `POST /api/meets/:id/schedule/sync` trusted positive
  quiz, slot and room IDs from the payload. A foreign quiz ID skipped the completed-quiz guard and
  had its seats deleted and rewritten, even for a completed quiz in another meet, and foreign rooms
  or slots linked the two meets' rows. Any slot, quiz or room that isn't the meet's is now refused
  with 400 before anything is written
* **Roster sync confined to its church** - `POST /api/churches/:churchId/roster/sync` trusted
  positive team IDs from the payload, so a coach (or an admin, via a throwaway church) could add or
  move quizzers into any team in any meet. A team that isn't the church's is now refused with 400
  before anything is written
* **No coach-code hashes in church lists** - `GET /api/meets/:meetId/churches`, which any viewer of
  the meet can read, no longer returns `coachCodeHash`

### Bundled contract

* `@qzr/shared@0.9.2` - unchanged

## [0.12.1] - 2026-10-01

### Fixed

* **Account takeover via OAuth auto-link** - upgrade better-auth 1.5.6 -> 1.6.33
  (GHSA-g38m-r43w-p2q7). Signing in with Google or GitHub no longer links onto an existing account
  whose email is unverified, so pre-registering someone's address with a password no longer captures
  their account. Since email/password accounts are never verified here, OAuth sign-in on an address
  that already has a password account now fails with "account not linked"; the user signs in with
  the password instead
* **Localhost trusted only in development** - Better Auth's `trustedOrigins` no longer includes
  `http://localhost:5173` / `:5174` when `ENVIRONMENT` is `production`

### Bundled contract

* `@qzr/shared@0.9.2` - unchanged

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
