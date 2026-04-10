# Roadmap

> When a feature ships, update both this file _and_ the user-facing
> `apps/web/src/views/RoadmapView.vue` — move it from "Coming soon" to "Available now".

## Completed

**Phase 0: Foundation** — Tauri 2 + Vue 3 + Vite scaffolding, native dev environment, ESLint,
Prettier, pre-commit hooks, GitHub Actions CI.

**Phase 1: Core UI** — Table layout, cell selector, live scoring, question highlighting, greyed-out
cells, A/B columns, overtime, validation with tooltips, editable names, placement points, individual
scores, question type dropdown, drag-drop reorder, keyboard navigation, undo/redo.

**Phase 2: Data Management** — Save/load JSON (TypeBox schema), auto-save to localStorage, new
quiz/reset, ODS export (template-based), ODS import.

**Phase 3: Distribution** — PWA on Cloudflare Pages (`www.versevault.ca/scoresheet/`), CI/CD
pipeline (deploy on tag), packaged releases for Windows/macOS/Linux via GitHub Releases.

**Phase 4.0: Monorepo conversion** — Restructured the repo into a pnpm workspace monorepo.

**Phase 4.1: Website / landing page** — Scaffolded `apps/web` as a full Vue 3 + vue-router Vite app.
Landing page covers what the scoresheet does today and sketches the planned meet platform. Combined
build: `pnpm build:all` produces `apps/web/dist/` with the scoresheet output nested at
`scoresheet/`; `pnpm deploy` builds and publishes both to the CF Pages project.

**Phase 4.2: API + database** — Hono on Cloudflare Workers with D1 and Drizzle. `packages/shared`
extracts the QuizFile TypeBox schema and role enums so the API can consume them without depending on
the scoresheet. `packages/api` has a typed Bindings interface, CORS + logger middleware,
`GET /health`, and the full Drizzle schema covering all tables from the data model. First D1
migration generated and committed. Worker is routed at `www.versevault.ca/api/*` (same origin as the
web app — no CORS in production).

**Phase 4.3: Authentication** — OAuth sign-in with GitHub and Google, plus email/password. Better
Auth handles the full auth stack: OAuth dance, sessions, account linking, and email/password
sign-up/sign-in.

* `better-auth` mounted at `/api/auth/*` in Hono
* DB schema: Better Auth's `user`, `session`, `account`, `verification` tables; `role` as an
  `additionalField` on `user` (default `normal`, not user-settable); FK references on `churches` and
  `*_memberships` use `user.id` (text UUID)
* Cookie-based sessions — no `localStorage` JWT, no redirect dance
* Account linking enabled for GitHub and Google (both verify email addresses)
* `useAuth` composable uses `better-auth/vue` `createAuthClient` + `useSession()`
* `SignInMenu` component in the portal header: GitHub, Google, or email/password form with sign-in /
  create-account toggle
* `callbackURL` uses `window.location.origin` so OAuth redirects return to the web app, not the API
* Guest JWTs for officials and viewers remain custom — Better Auth handles user auth only

**Phase 4.4: Meet join codes** — Enter a code to gain a meet-scoped role: `head_coach`, `official`,
or `viewer`. Coaches must have an account.

* Session middleware reads Better Auth cookies, with `requireAuth` (401) and `requireSuperuser`
  (403) guards
* Superuser-only meet CRUD: `POST/GET/PATCH/DELETE /api/meets`, with official code management
  (`POST/DELETE /api/meets/:id/official-codes`, rotate endpoints)
* Coach codes are per-meet, server-generated, stored as SHA-256 hashes; viewer codes are
  superuser-set plaintext slugs; official codes are per-room with independent rotation
* `POST /api/join` (authenticated) — accepts `{ code }`, resolves meet + role via viewer slug match
  → admin hash match → coach hash match → official hash match, creates idempotent membership row;
  signed-in users with the viewer role can see the meet dashboard (meet info, church list, team
  counts) with all edit controls hidden
* `POST /api/join/guest` — endpoint exists and issues a guest JWT for official or viewer codes, but
  the token is not yet consumed anywhere: the session middleware has no Bearer token path and there
  is no frontend code entry UI. Full guest flow is implemented in 4.11.
* `GET /api/my-meets` — returns all meets the user has joined, with their role(s)
* DB injection via Hono context variables; test suite uses `better-sqlite3` in-memory DB with full
  schema for integration tests

**Phase 4.5: Superuser dashboard** — Create and manage quiz meets from the portal.

* `GET/POST /api/meets` — list and create meets (superuser only)
* `GET/PATCH/DELETE /api/meets/:id` — meet detail, edit name/dates/viewer code/divisions
* `POST/DELETE /api/meets/:id/official-codes` + rotate — per-room official code management
* `apps/web/src/api.ts` — typed fetch wrapper with cookie credentials for all endpoints
* `quiz_meets` schema: `date_from` (not null) + `date_to` (nullable) for multi-day meets

**Phase 4.6: Coach roster flow** — Coaches join a meet, then build team rosters for their church.
Roster editing uses a draft model — all changes are local until the coach clicks Save.

* Full church/team/quizzer CRUD (`GET/POST/PATCH/DELETE` for churches, teams, quizzers)
* `MeetTeamsView` — single-church view, unassigned pool, team cards with drag reorder, draft
  save/discard bar, per-team size and division-order warnings
* Edit gating: coaches can only edit their own church; admins and superusers can edit any church

**Phase 4.6a: Role model and dashboard** — Per-church coach codes, meet-scoped admin role,
consolidated dashboard with role-based visibility.

* Schema: `quiz_meets.admin_code_hash`, `admin_memberships`, `churches.coach_code_hash`,
  `coach_memberships(accountId, churchId, meetId)`
* `POST /api/join` — 3-way code matching: admin → church coach → official
* Admin code and coach code rotate endpoints with optional `clearMembers`
* `GET /api/meets/:id/members` — list all members across all role tables (admin/superuser)
* `DELETE /api/meets/:id/members/:userId` — revoke a specific membership by role + scope
* `QuizMeetView` (dashboard) — single page for the entire meet, role-gated: meet info header, inline
  edit card, admin section, churches list, rooms list, access dialogs

**Phase 4.6b: Batch roster sync** — Replace sequential per-resource API calls with bulk endpoints.

* `POST /api/churches/:id/roster/sync` — client sends desired state; server diffs and applies all
  creates/updates/deletes/moves sequentially; returns full resolved state with real IDs
* `POST /api/meets/:id/roster/import` — parse CSV entries, match/create churches, deduplicate teams
* `GET /api/meets/:id/roster/export` — single join query, flat rows
* `GET /api/meets/:id/churches` returns `teamCount` via left-join + group-by

---

## Backlog

Optional items that can happen any time, independent of Phase 4.

* **Tablet-optimized touch targets** — larger hit areas and touch-friendly spacing for live quizzes
* **Android APK** — `pnpm tauri android build --apk --target aarch64`; needs Android SDK + NDK
  setup, plugin compatibility check (`tauri-plugin-fs`, `tauri-plugin-dialog`), tablet layout
  testing, and a manual or custom CI release step (`tauri-action` doesn't support mobile builds yet)
* **Custom question type dropdown** — replace native `<select>` for consistent cross-browser styling
* **Print-friendly layout** — CSS print styles, hide UI chrome, format for A4/letter
* **Code signing** — macOS notarization and Windows signing for warning-free installers
* **Auto-updater** — Tauri's built-in update mechanism
* **Seat bonuses** — per the rules, bonus questions go to the "corresponding chair" on the remaining
  team (the same seat number as the quizzer who erred), not the whole team. Currently any quizzer on
  the bonus team can answer. Implementing this means: identifying which seat the bonus targets,
  greying out non-target seats on bonus questions, and validating that only the correct seat answers

---

## In Progress / Up Next

### Interactive Tutorial

Guided walkthrough that teaches a new user how to fill out a quiz scoresheet. Runs in a sandbox —
snapshots current state, resets to a clean scoresheet, walks through a scripted quiz with real
interactions (click cells, select answers, assign names), then restores the original state on
completion or cancel.

**Approach:**

* Tooltip/highlight library (Driver.js or Shepherd.js) for step-by-step popovers pointing at UI
  elements
* Custom step engine: each step defines a target element, instruction text, and an expected action;
  the tutorial advances only when the user performs the correct action
* Sandbox composable: snapshot all reactive state (cells, names, timeouts, meta) before entering
  tutorial mode; restore on exit
* Accessible from a help menu; replayable any time

**Scenario covers:**

* Naming teams and all 5 quizzers (including the 5th/substitute quizzer)
* On-time bonus (before Q1)
* Correct answers, errors, toss-ups, and bonus questions
* No-jump toggle
* Calling a timeout and swapping the 5th quizzer in
* Question type dropdown

**Library:** Driver.js (~5 KB, zero dependencies) for overlay/spotlight/tooltip.

**Design questions to resolve before starting:**

* How to handle the quizzer swap step — drag reorder vs a simpler "click to swap" UI during tutorial

---

### Phase 4.7: Scoresheet — load teams from meet

UX for switching between offline mode (status quo) and online mode (auth-gated, pull team data from
the API). These are two distinct sub-features with separate dependencies.

**4.7a: Toolbar restructure** ✅

Pure UI refactor — no API calls, no auth. Safe to implement first and independently.

* `[Save ▼]` submenu replaces the flat Save + Export buttons:
  * Save as JSON (current `saveFile()`)
  * Export ODS (current `exportOds()`)
  * (placeholder for 4.8 Submit, hidden for now)
* `[Open]` unchanged — auto-detects JSON vs ODS import
* `[New ▼]` submenu replaces the single New button:
  * **New quiz** — full reset, dirty check (current behaviour)
  * **Clear answers** — wipe all cells, keep names and meta
  * **Clear names** — wipe team/quizzer names AND disconnect from meet (resets `meetSession`)
  * **Load teams from meet…** — active in 4.7b
* `useScoresheet` gains `clearAnswers()` and `clearNames()` alongside the existing `resetStore()`
* Keyboard shortcut Ctrl+N still triggers full reset (same as “New quiz”)

**4.7b: Quizmeet mode** ✅ (requires being already signed in to the portal in the same browser)

Uses the existing Better Auth cookie session — no new sign-in UI yet. On web (PWA), if the user is
already signed into `www.versevault.ca`, the scoresheet at `/scoresheet/` shares the same cookie and
can make credentialed API calls immediately. On Tauri/desktop, this phase is a no-op — it simply
won’t work until 4.7c.

_New API endpoint (in `packages/api`):_

* `GET /api/meets/:id/teams` — returns all teams for a meet with church label in one call:
  `{ teams: [{ id, churchId, churchName, churchShortName, division, number }][] }`
* Access rule: any authenticated member of the meet can read (same as churches endpoint)

_New composable `useMeetSession`:_

* Holds: `meetId`, `meetName`, full team list, per-slot
  `{ teamId, dbLabel, dbLabelFull, quizzers[] }`; quizzer list always padded to `QUIZZERS_PER_TEAM`
  (empty seats have `dbName: ‘’`)
* `loadMeet(meetId)` — fetches team list, activates mode
* `assignTeam(slotIdx, teamId)` — fetches quizzer roster, populates slot
* `reorderSlotQuizzers(slotIdx, from, to)` — mirrors drag-reorder so divergence detection stays
  correct
* `clearSession()` — resets all session state
* Persists to localStorage (separate key); on restore, re-fetches the team list

_Meet picker dialog:_

* Only shown when a session cookie exists (`GET /api/my-meets` returns results)
* Single step: pick a meet from the list
* After confirming, team assignment happens inline in the scoresheet

_Quizmeet mode UI:_

* Active whenever `meetSession` is set; reset by “Clear names” or “New quiz”
* A small `🔗 MeetName` pill in the left meta bar
* Team name cell → **custom dropdown** (teleported to body, keyboard + click-outside dismissal);
  shows full church name when space permits, short name otherwise (`v-fit-name` directive);
  selecting a team auto-populates quizzer names
* Quizzer name cells remain editable; a name that diverges from `dbName` gets an amber underline + a
  `↺` restore button (tooltip shows DB name)

**4.7c: Sign-in widget** ✅

* `better-auth` added to scoresheet; `useAuth` composable wraps `createAuthClient` + `useSession()`
* `SignInWidget` component in the right meta bar: GitHub, Google, and email/password — matches the
  portal’s `SignInMenu`; signed-in state shows email with sign-out dropdown
* Signing out also clears the meet session (`clearSession()`)
* `__API_URL__` in `vite.config.ts`: prod Tauri → `https://www.versevault.ca`, prod web → `’’`
  (same-origin), dev (any) → `http://localhost:8787`
* API CORS updated to allow Tauri webview origins in production (`tauri://localhost`,
  `https://tauri.localhost`); dev still allows `localhost:5173/5174`; environment-gated via
  `ENVIRONMENT` binding so dev localhost ports are never in the production allowlist
* `useHttpsScheme: true` in `tauri.conf.json` so Windows webview uses `https://tauri.localhost`
  (fixes cookie delivery — HTTP origins can’t receive `SameSite=Lax` cookies cross-origin)
* Better Auth `trustedOrigins` extended with both Tauri production origins
* `pnpm dev:tauri:linux-x11` added — starts portal, API, and Tauri dev window together

**4.7e: Division dropdown + consolation support** ✅

* Added `consolation: boolean` column to `teams` table (migration `0001_colorful_serpent_society`)
* `GET /api/meets/:id/teams` now returns `consolation` per team + `meetDivisions: string[]`
* New API endpoints `POST/DELETE /api/teams/:id/consolation` (admin/superuser only) — portal UI for
  toggling consolation deferred to Phase 4.10
* Scoresheet division field becomes a `<select>` dropdown when meet-linked; options show base
  divisions plus `"{div}c"` for any division with ≥1 consolation team
* Team picker filters by selected division — "2" shows non-consolation div-2 teams; "2c" shows
  consolation div-2 teams; `quiz.division` stores `"2c"` in the saved `.qzr` file

**4.7d: Load teams from schedule** — pre-populate scoresheet from a scheduled quiz (depends on
4.10a):

* “Load teams from meet…” dialog gains a second mode: pick a scheduled quiz instead of manually
  selecting teams per slot
* Teams and seat order come from `quiz_teams`; quizzers pulled from roster
* Sets `quizId` on the meetSession so the Submit flow (4.8) knows which quiz to post to
* Portal schedule view → click assigned quiz → opens `/scoresheet/?quiz=id`

**Note on code/guest path:** After 4.11 (guest access), the meet picker will also accept a join code
so it works without signing in. That is explicitly deferred — 4.7b and 4.7c only use existing Better
Auth cookie sessions.

### Phase 4.8: Results submission

Officials submit completed scoresheets to the server. Submitted results are immutable. This phase
does **not** depend on the schedule — a result is a standalone record attached to a meet, not a
scheduled quiz entry. Schedule integration (matching results to `quiz_teams` rows) is deferred to
Phase 4.10.

**Database schema:**

* `quiz_results(id, meetId, submittedAt, submittedBy, round, room, quizFile)` — immutable; `meetId`
  is the only required FK; `quizId` nullable (populated later when schedule exists)
* `quiz_disputes(id, resultId, createdBy, reason, resolved)` — flag suspicious results for review

**Auth for submission:**

* Only officials (guest JWT + room code match, or signed-in official user) can submit
* `POST /api/meets/:id/results` — validate auth role, validate `QuizFile` schema, write atomically;
  409 if a result for the same round + room already exists
* `GET /api/meets/:id/results` — list all submitted results (admin/superuser)
* Flag / unflag for dispute (`PATCH`); view full result JSON in modal

**Scoresheet changes:**

* “Submit” button appears when scoresheet is clean and all cells are valid
* POST to `/api/meets/:id/results` with `QuizFile` body + round + room metadata
* On success: show confirmation, lock the UI
* On 409: explain, offer to download local copy

### Phase 4.9: Stats calculator

Aggregate individual and team performance across all submitted results in a meet.

**Pure functions in `packages/shared/scoring`:**

* `aggregateTeamStats(results[])` — sum points, bin by question type, count placements
* `aggregateQuizzerStats(results[], quizzerId)` — filter entries for that quizzer, compute totals
* `individualsRank(quizzerStats[])` — sort by points, break ties by correctness ratio

**API:**

* `GET /api/meets/:id/stats/teams` — per-team totals: points, correct/incorrect/blank by question
  range, placement finishes; optionally filter by division
* `GET /api/meets/:id/stats/quizzers` — per-quizzer: points, correct/incorrect/blank, matches
  played, average per-round
* `GET /api/meets/:id/stats/quizzers/:quizzerId` — detailed breakdown: all quizzes, per-round
  scores, Q17–20 performance, overtime streaks

**Portal views:**

* `MeetStatsView` — tabs: Teams, Individuals; sortable tables (visible to all roles including
  viewer)
* `QuizzerDetailView` — all-time performance at the meet: points trend, Q distribution, match log

**Note:** Stats are read-only and computed lazily from immutable `quiz_results` rows. No real-time
computation — compute on-demand or cache rolled-up queries.

### Phase 4.10: Schedule — generation, management, and views

Admins generate round-robin schedules assigning teams to rooms and rounds. This is the most complex
phase and will need careful UX design before implementation. See `docs/architecture.md` and
`docs/data-model.md`.

**Sub-phases:**

* **4.10a: Generation + schema** — Pure RR generation in `packages/shared/scheduling` (input: team
  list per division, # rounds, # rooms → `{ round, room, teams[] }[]`); DB tables
  `quizzes(id, meetId, round, room, scheduledAt, completedAt, canceledAt)` and
  `quiz_teams(quizId, teamId, seatNumber)`; `POST /api/meets/:id/generate-schedule`
* **4.10b: Schedule view + publish** — Portal schedule table (round, room, teams, status); publish
  flag; coaches/viewers see their quizzes once published
* **4.10c: Manual editing** — Swap teams between quizzes before publishing; undo/redo
* **4.10d: Re-generation** — Handle late-added teams: targeted insertion or full re-generate
* **4.10e: Result linkage** — Match existing `quiz_results` rows to `quizzes` entries by round +
  room; backfill `quiz_results.quizId`; enable submit-by-quiz-id flow from 4.7b

**Design questions to resolve before starting:**

* How are divisions scheduled — separately, together, or interleaved?
* How does the algorithm handle an odd number of teams or teams that can’t be fairly paired?
* What does the admin UI look like for previewing and swapping before publishing?

### Phase 4.11: Guest access

Unauthenticated access via a code, without creating an account. Signed-in viewer access already
works (4.4) — this phase adds the no-account path for officials and viewers.

`POST /api/join/guest` already exists and signs JWTs, but entering a code currently does nothing —
the token is dropped. This phase wires up the full end-to-end flow:

* Session middleware updated to accept `Authorization: Bearer <token>` as an alternative to cookie
  auth, so all credentialed API routes work for guest sessions
* Frontend code entry UI — a dialog/page where an unauthenticated user enters a code, gets a JWT
  back, and the token is stored (e.g. `sessionStorage`) for the duration of the session
* Meet picker dialog in the scoresheet (4.7b/c) can now accept a code instead of requiring a
  signed-in session

**Design questions:**

* What's the lifetime and storage strategy for guest sessions — same 24h JWT, or a longer-lived
  cookie-backed anonymous session?
* Admin codes almost certainly require an account (audit trail, revocation). Confirm that hard
  boundary.

**Note:** Coach guest sessions are not planned — coaches must have an account (stable identity
needed for roster ownership). Guest viewer access is read-only; guest official access is scoped to
their assigned room.

### Phase 4.13: Quizzer identity linking

Quizzers are currently created per-meet as plain name strings. This phase introduces a persistent
identity layer so that stats, history, and profiles can span multiple meets.

**Design questions (must resolve before implementation):**

* What is the canonical identity unit — a global `quizzers` table, or per-church quizzer records
  with cross-meet linking?
* Who owns a quizzer identity — the church, a superuser, or the quizzer themselves?
* How are matches suggested — exact name match, fuzzy match, coach confirmation, or manual merge?
* What happens to historical stats if two identities are merged or a link is reversed?
* Does a quizzer ever have a login? (e.g., to view their own stats page)

**Likely approach:**

* Introduce a `quizzer_identities(id, displayName, churchId)` table as the stable anchor
* `quizzers` (per-meet roster entries) gain a nullable FK `identityId`
* Linking UI: after roster import, coach sees a “match to known quizzer” suggestion list; exact-name
  matches are pre-confirmed, fuzzy matches require manual confirmation
* Stats endpoints accept either `quizzerId` (meet-scoped) or `identityId` (cross-meet)
* Merging and un-linking are admin-only operations with an audit log
