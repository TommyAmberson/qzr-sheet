# Roadmap

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
or `viewer`. Officials and viewers can use guest JWTs without creating an account.

* Session middleware reads Better Auth cookies, with `requireAuth` (401) and `requireSuperuser`
  (403) guards
* Superuser-only meet CRUD: `POST/GET/PATCH/DELETE /api/meets`, with official code management
  (`POST/DELETE /api/meets/:id/official-codes`, rotate endpoints)
* Coach codes are per-meet, server-generated, stored as SHA-256 hashes; viewer codes are
  superuser-set plaintext slugs; official codes are per-room with independent rotation
* `POST /api/join` (authenticated) — accepts `{ code }`, resolves meet + role via viewer slug match
  → coach hash match → official hash match, creates idempotent membership row
* `POST /api/join/guest` (unauthenticated) — accepts official or viewer codes, returns a short-lived
  guest JWT (24h, signed with `jose` via Web Crypto). Coach codes rejected — coaches must have an
  account
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

---

## In Progress / Up Next

### Phase 4.7: Scoresheet — load teams from meet

UX for switching between offline mode (status quo) and online mode (auth-gated, pull team data from
the API). These are two distinct sub-features with separate dependencies.

**4.7a: Load teams by roster** — fill scoresheet from meet roster without a scheduled quiz:

* Sign in to the portal from the scoresheet header (cookie auth, session indicator)
* “Load from meet” dialog: pick a meet from `GET /api/my-meets`, then select a team for each
  scoresheet row (1–5) from that meet’s roster
* Auto-fills team names and quizzer names in the column headers
* Graceful fallback: user’s role doesn’t grant access → show warning, allow manual override
* New composable `useRosterLoad()` — fetch meet/team data, validate counts, map to `cells` grid

**4.7b: Load teams from schedule** — pre-populate scoresheet from a scheduled quiz (depends on
4.10a):

* Select a quiz from the meet schedule; teams and seat assignments come from `quiz_teams`
* Option to include quizzers from the roster or leave quizzer names blank
* Sets `quizId` on the scoresheet so the Submit button (4.8) knows which quiz to post to
* Portal schedule view → click assigned quiz → opens `/scoresheet/?quiz=id`

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

* `MeetStatsView` — tabs: Teams, Individuals; sortable tables
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

### Phase 4.11: Viewer access

Read-only portal views for standings, stats, and schedules. No account required — guest JWT via
viewer code.

* `GET /api/meets/:id/standings` — team standings derived from submitted results
* `GET /api/meets/:id/schedule` — published schedule (respects `schedule_published` flag)
* Portal viewer pages: standings table, schedule, individual quizzer stats
* Guest JWT auth flow: enter viewer code → JWT issued → stored for session duration

### Phase 4.12: Guest access expansion

Currently guest JWTs cover officials and viewers only — coaches must have an account. This phase
expands code-based access so that any role (except possibly admin) can operate without an account.

**Design questions:**

* Should coach guest sessions be allowed? If so, how is church ownership scoped without a stable
  user identity? (A guest coach could corrupt another guest’s draft.)
* What’s the lifetime and storage strategy for guest sessions — same 24h JWT, or a longer-lived
  cookie-backed anonymous session?
* Admin codes almost certainly require an account (audit trail, revocation). Confirm that hard
  boundary.

**Likely approach:** issue a named guest session (display name entered at join time) backed by a
short-lived JWT with a `guestRole` claim. Read-write access scoped to the code’s role, but no
ability to create an account-linked membership or access admin tools.

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
