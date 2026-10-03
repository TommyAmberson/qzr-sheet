# Changelog — @qzr/web

All notable changes to the web portal (coach roster management, admin dashboard) are documented
here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Released via `.github/workflows/deploy-web.yml` (the `qzr-web` Worker, serving
www.versevault.ca/qzr/) on every `version` bump in `apps/web/package.json` that lands on `master`.
The same Worker also gets redeployed by `.github/workflows/release-scoresheet.yml` on scoresheet
bumps: that workflow rebuilds the bundled scoresheet PWA at `/qzr/scoresheet/` alongside whatever
portal build is current. Releases up to 0.11.x went to the `versevault-www` Pages project.

The portal shipped as part of the unified monorepo versioning era under tags `v0.2.0`–`v0.9.1`; see
[`apps/scoresheet/CHANGELOG.md`](../scoresheet/CHANGELOG.md) for historical entries that covered the
portal. This per-package changelog starts fresh from 0.9.1 as the baseline.

## [Unreleased]

## [0.17.0] - 2026-10-02

### Added

* **A quiz's page** - each quiz on the Results page links to a page of its own, open to the meet's
  admins and the quiz's room officials: a quick form to change team and quizzer names, division and
  quiz number; the quiz's history, each save with who, when and how, its teams and scores, and
  counting changes; Restore for an earlier revision; and Open in scoresheet for any revision

### Bundled contract

* `@qzr/shared@1.4.0` - bumped from 1.3.0

## [0.16.0] - 2026-10-02

### Added

* **Uploading quizzes** - the Results page has an upload area for a meet's admins and officials:
  saved quiz files are sent one at a time, by name, for a room (an admin may pick none), asking
  about any name the meet already has, with a report of what became of each
* **Results for officials** - officials, signed in or by room code, see the quizzes their rooms have
  saved, without counting or standings; the meet page links signed-in officials to them

### Fixed

* Joining a meet with a code while signed out now keeps the session, so the portal can use it; an
  official is taken to the meet's results

### Bundled contract

* `@qzr/shared@1.3.0` - unchanged

## [0.15.0] - 2026-10-02

### Added

* **Standings** - a meet's Results page now ranks each division's teams over the quizzes its admins
  count: placement points, quizzes played, the tie-break that decided a tie (head-to-head, total
  points, then fewest errors), and the three finalists. Warnings name teams with different numbers
  of counted quizzes, counted quizzes that can't be placed, and a tie for the last places in the
  final
* **Counting quizzes** - each quiz on the Results page has a Counted box, with Count all and Uncount
  all, and every change is recorded with who made it and when

### Fixed

* The Results page names each quiz as officials know it ("D1c Q3" for consolation), and shows where
  it came from, the room that first submitted it or who uploaded it, even once that room is deleted
  (#104)

### Bundled contract

* `@qzr/shared@1.3.0` - bumped from 1.2.0

## [0.14.0] - 2026-10-02

### Added

* **Meet results** - a meet's admins get a Results page listing the quizzes officials submit, by
  division as each quiz records it, with the teams' scores (and, once placed, their places and
  placement points), the room, the revision number, who saved it last, how and when, and whether it
  counts in the standings

### Bundled contract

* `@qzr/shared@1.2.0` - bumped from 1.1.0

## [0.13.0] - 2026-10-02

Switch day: verse-vault takes the root of www.versevault.ca, and qzr's old addresses move to
`/qzr/`.

### Added

* **Old addresses redirect into `/qzr/`** - the `qzr-web` Worker takes the routes `/scoresheet`,
  `/scoresheet/*`, and `/roadmap` and answers `308` to the same path under `/qzr/`, query kept, so
  shared scoresheet links (`/scoresheet/?meet=...`) keep working. Old meet links (`/<slug>`) are
  sent to `/qzr/<slug>` by verse-vault's catch-all route
* **Old scoresheet installs clean themselves up** - `/scoresheet/sw.js` serves a self-destroying
  service worker. The next time an install made from `/scoresheet/` is opened online, it deletes the
  old offline copy, unregisters, and moves to `/qzr/scoresheet/`. Saved scoresheets are kept, and
  scoring offline still works until then

### Bundled contract

* `@qzr/shared@1.1.0` - bumped from 1.0.0 (scoring and quiz-file reading moved into shared; the
  portal doesn't use them yet)

## [0.12.2] - 2026-10-01

### Changed

* The roadmap page lists 15-question quizzes under "Available now".

### Bundled contract

* `@qzr/shared@1.0.0` - bumped from 0.10.0

## [0.12.1] - 2026-10-01

### Fixed

* **Refused social sign-in explained** - since API 0.12.1 (better-auth 1.6.33), signing in with
  GitHub or Google on an address that already has a password account is refused rather than merged,
  and the browser landed on Better Auth's bare error page. It now returns to the page it started on
  with the sign-in menu open on email sign-in and a note to sign in the way the account was created.
  Other failed social sign-ins return with a "try again" message. The `?error=` is removed from the
  address once read
* **Signing in from the mobile menu** - tapping Sign in in the phone sidebar closed the sidebar, and
  the sign-in form with it. The sidebar now stays open until you sign in

### Bundled contract

* `@qzr/shared@0.10.0` - bumped from 0.9.2 (`signInSocial` error return, `socialSignInError()`)

## [0.12.0] — 2026-10-01

### Changed

* **Served at `/qzr/`** - the portal moves from the root of www.versevault.ca to `/qzr/` so
  verse-vault can take the root. Hosting moves from the `versevault-www` Pages project to the
  `qzr-web` Worker (Workers Static Assets), which also serves the bundled scoresheet at
  `/qzr/scoresheet/`

### Added

* **Not-found page** - unknown multi-level addresses show a "Page not found" page instead of a blank
  screen. Single-level addresses are still treated as meet slugs

### Bundled contract

* `@qzr/shared@0.9.2` — unchanged

## [0.11.0] — 2026-10-01

### Added

* **Open a scheduled quiz in the scoresheet** — on the read-only schedule view, each quiz label is a
  link to the scoresheet with `?meet=<id>&quiz=<id>`, which prefills that quiz's teams and rosters.
  The link is same-origin, so the scoresheet inherits the signed-in session or guest token. The
  editable schedule keeps its edit button

### Changed

* **Schedule grid shared with the scoresheet** — the grid renderer and its helpers (`buildGrid`,
  `groupRowsByDay`, `formatSlotTime`, seat helpers) move to `@qzr/ui` as `ScheduleGrid`, so the
  scoresheet's schedule picker draws the same grid. `ReviewSection` wraps it and supplies its
  editing controls through named slots; `apps/web/src/scheduleGrid.ts` re-exports for existing
  importers

### Bundled contract

* `@qzr/shared@0.9.2` — unchanged

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
