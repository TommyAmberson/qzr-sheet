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

## Phase 4: Quizmeet Integration

See `docs/architecture.md`, `docs/auth.md`, `docs/roles-and-access.md`, and `docs/data-model.md` for
the full design.

### 4.0 Monorepo conversion ✓

Restructured the repo into a pnpm workspace monorepo.

### 4.1 Website / landing page ✓

Scaffolded `apps/web` as a full Vue 3 + vue-router Vite app. Landing page covers what the scoresheet
does today and sketches the planned meet platform (standings, schedule, rosters, official flow,
admin). Honest WIP framing — no branding name yet. Combined build: `pnpm build:all` produces
`apps/web/dist/` with the scoresheet output nested at `scoresheet/`; `pnpm deploy` builds and
publishes both to the CF Pages project.

### 4.2 API + database ✓

Hono on Cloudflare Workers with D1 and Drizzle. `packages/shared` extracts the QuizFile TypeBox
schema and role enums so the API can consume them without depending on the scoresheet.
`packages/api` has a typed Bindings interface, CORS + logger middleware, `GET /health`, and the full
Drizzle schema covering all tables from the data model. First D1 migration generated and committed.
Worker is routed at `www.versevault.ca/api/*` (same origin as the web app — no CORS in production).

### 4.3 Authentication ✓

OAuth sign-in with GitHub and Google, plus email/password. Better Auth handles the full auth stack:
OAuth dance, sessions, account linking, and email/password sign-up/sign-in.

* `better-auth` mounted at `/api/auth/*` in Hono — replaces the hand-rolled Arctic + JWT layer
* DB schema: Better Auth's `user`, `session`, `account`, `verification` tables; `role` as an
  `additionalField` on `user` (default `normal`, not user-settable); FK references on `churches` and
  `*_memberships` use `user.id` (text UUID)
* Cookie-based sessions — no `localStorage` JWT, no redirect dance, no `AuthDoneView`
* Account linking enabled for GitHub and Google (both verify email addresses)
* `useAuth` composable uses `better-auth/vue` `createAuthClient` + `useSession()`
* `SignInMenu` component in the portal header: GitHub, Google, or email/password form with sign-in /
  create-account toggle
* `callbackURL` uses `window.location.origin` so OAuth redirects return to the web app, not the API
* Guest JWTs for officials and viewers remain custom — Better Auth handles user auth only

### 4.4 Meet join codes ✓

Enter a code to gain a meet-scoped role: `head_coach`, `official`, or `viewer`. Officials and
viewers can use guest JWTs without creating an account.

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

### 4.5 Superuser dashboard ✓ (partial)

Create and manage quiz meets from the portal. Superuser nav link visible only to
`role === 'superuser'` accounts. Router guard redirects others to home.

* `GET/POST /api/meets` — list and create meets
* `GET/PATCH/DELETE /api/meets/:id` — meet detail, edit name/dates/viewer code
* `POST /api/meets/:id/rotate-coach-code` — rotate the per-meet coach code (revealed once on
  creation/rotation); this will be superseded by per-church codes in **4.6a**
* `POST/DELETE /api/meets/:id/official-codes` + rotate — per-room official code management
* `apps/web/src/api.ts` — typed fetch wrapper with cookie credentials for all endpoints
* `MeetSuperuserView` — manage the meet's coach code and official codes
* `quiz_meets` schema: `date_from` (not null) + `date_to` (nullable) for multi-day meets

### 4.6 Coach roster flow ✓ (in progress)

Coaches join a meet, then build team rosters for their church. Roster editing uses a draft model —
all changes are local until the coach clicks Save, which flushes a minimal diff to the API.

* `GET /api/meets/:id/churches` — list churches for the meet (any authenticated member can read)
* `POST /api/meets/:id/churches` — create a church (coach-authed; will move to superuser/admin in
  **4.6a**)
* `GET /api/churches/:id/teams` — list teams under a church
* `POST /api/churches/:id/teams` — create a team; number auto-increments per church
* `PATCH /api/teams/:id` — update a team's division
* `DELETE /api/teams/:id` — delete a team and its roster (cascade)
* `GET/POST /api/teams/:id/quizzers` — list and add roster entries
* `PATCH /api/teams/:id/quizzers/:quizzerId` — rename a quizzer
* `DELETE /api/teams/:id/quizzers/:quizzerId` — remove from roster
* `MeetTeamsView` — church tabs, unassigned pool, team cards with drag reorder, draft save/discard
  bar, per-team size and division-order warnings
* Edit gating: coaches can only edit churches they created (`church.createdBy`); will move to
  `CoachMembership` lookup in **4.6a**

Identity linking (name-match suggestions, church-change warnings) deferred to a later step.

### 4.6a Role model transition (next)

Transition from the current per-meet coach code to per-church coach codes, and introduce the
meet-scoped admin role. See `docs/roles-and-access.md` and `docs/data-model.md` for the target
design.

**Schema changes** (two migrations — nullable first, then non-null):

* `quiz_meets`: rename `coach_code_hash` → `admin_code_hash`
* New table `admin_memberships(accountId, meetId)` — replaces `coach_memberships` for meet-level
  access
* `churches`: add `coach_code_hash`, drop `created_by`
* `coach_memberships`: replace `meetId`-only unique with `(accountId, churchId)`; keep `meetId` as a
  denormalised convenience column for `getMyMeets()`

**API changes**:

* `POST /api/join` — add admin code lookup and per-church coach code lookup
* `POST /api/meets/:id/rotate-admin-code` — replaces `rotate-coach-code`; accepts
  `{ clearMembers: boolean }`
* `POST /api/churches/:id/rotate-coach-code` — new; accepts `{ clearMembers: boolean }`
* `POST /api/meets/:id/churches` — restrict to superuser or admin (remove coach self-serve)
* All church/team edit routes — replace `church.createdBy === user.id` gating with `CoachMembership`
  lookup
* `GET /api/my-meets` — update to join through `admin_memberships` and `coach_memberships.meetId`

**Portal changes**:

* `MeetSuperuserView` — add per-church coach code rows (create church → code revealed; rotate with
  or without clearing members)
* `MeetTeamsView` — remove self-serve church creation; `canEdit` based on `CoachMembership` row
  instead of `createdBy`; coaches see only their church tab as editable
* `MeetRole` enum — add `Admin`; update `getMyMeets` response shape

### 4.7 Admin: schedule and draw

Once teams are registered, an admin generates the round-robin draw and publishes the schedule.

* Draw algorithm — assign teams to rooms and rounds; configurable round count and room count
* `POST /api/meets/:id/draw` — generate and persist the draw; idempotent (re-running replaces
  existing schedule)
* `GET /api/meets/:id/schedule` — full schedule: rounds, rooms, team assignments
* Admin portal views: registered teams list per division, draw configuration (rounds, rooms),
  generated schedule table, ability to manually swap assignments before publishing
* `quiz_meets.schedule_published` flag — controls whether viewers and coaches can see the schedule

### 4.8 Admin: results and accounts

* Review submitted quiz results — list of completed `QuizFile` submissions per meet, flag disputed
  results, override scores
* Account management — list users, promote/demote superuser role, revoke meet memberships
* Merge quizzer identities — resolve cases where a quizzer has two `QuizzerIdentity` records

### 4.9 Official flow

Load assigned quiz details from the API and pre-populate the scoresheet. Submit completed results
back to the server. Depends on 4.7 (schedule must exist).

* `GET /api/quizzes/:id` — quiz detail: teams, quizzers, room, round
* `POST /api/quizzes/:id/result` — submit a completed `QuizFile`
* Two entry points:
  * Portal schedule view → click assigned quiz → opens `/scoresheet/?quiz=id`
  * Scoresheet sign-in + quiz picker modal (for officials using the native app)
* Scoresheet additions: sign-in button, Load Quiz modal, Submit button, connected status in meta bar

### 4.10 Viewer access

Read-only portal views for standings, stats, and schedules. No account required — guest JWT issued
via viewer code.

* `GET /api/meets/:id/standings` — team standings derived from submitted results
* `GET /api/meets/:id/schedule` — published schedule (respects `schedule_published` flag)
* Portal viewer pages: standings table, schedule, individual quizzer stats
* Guest JWT auth flow: enter viewer code → JWT issued → stored for session duration
