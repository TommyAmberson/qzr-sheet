# Changelog

## 0.5.1

### Added

* **Android APK** — unsigned APK included in releases; new `pnpm android:build` script

### Improved

* **Sticky running total** — team score row stays fixed while scrolling horizontally; shows baseline
  (pre-scroll) score once the first question column is obscured
* **Mobile scoresheet** — larger tap targets, visible controls, clamped cell-selector popup on touch
  devices
* **Mobile portal** — hamburger sidebar nav, responsive team cards grid, pointer-event drag reorder
  for rosters (replaces HTML5 drag API, which crashes on Linux/X11 and doesn't work on touch)

## 0.5.0

### Added

* **Quizmeet mode (4.7a–c)** — scoresheet can link to a live meet: sign in with GitHub, Google, or
  email from within the scoresheet; pick a meet from your joined list; select teams from a
  searchable dropdown that auto-populates quizzer names; quizzer names that diverge from the roster
  get an amber underline with a restore button
* **Sign-in widget (4.7c)** — auth UI built into the scoresheet's meta bar; works in both the PWA
  and Tauri desktop app; signing out clears the meet session
* **Tauri auth support (4.7c)** — Tauri webview origins added to CORS and Better Auth trusted
  origins; `useHttpsScheme` enabled so cookies are delivered correctly on Windows
* **Save / New submenus (4.7a)** — `[Save ▼]` offers Save as JSON and Export ODS; `[New ▼]` offers
  New quiz, Clear answers, Clear names, and Load teams from meet
* **Consolation division support (4.7e)** — `consolation` boolean column on teams; scoresheet
  division field becomes a dropdown when meet-linked, with `"{div}c"` options for divisions that
  have consolation teams; team picker filters to the selected division/bracket;
  `POST/DELETE /api/teams/:id/consolation` endpoints for admin use; `GET /api/meets/:id/teams`
  returns consolation flag and canonical division list
* **Roadmap page** — user-facing `/roadmap` route on the portal listing available and upcoming
  features; linked from the header, footer, and home page

### Improved

* **Scoresheet meta-bar** — Division + consolation + Quiz# grouped into a single bordered pill;
  undo/redo wrapped in a joined pill; status shown as a colored-accent-border badge; `·` dot
  separators removed; theme toggle styled to match file-action buttons
* **Meet picker dialog** — join-code input added so users can join a new meet without leaving the
  scoresheet; dialog properly centered in Tauri/WebKit

### Fixed

* **Division select dark mode (Tauri)** — native `<select>` ignored CSS variables in the WebKit
  webview; `appearance: none` with a CSS background-image arrow fixes rendering
* **Meet picker dialog centering (Tauri)** — `<dialog>` default centering ignored by WebKit;
  switched to `position: fixed` + `transform: translate(-50%, -50%)`

## 0.4.1

### Added

* **Batch roster sync (4.6b)** — `POST /api/churches/:id/roster/sync` replaces `saveDraft`'s ~10
  sequential API calls with a single request; client sends full desired state (ordered teams +
  quizzer names + unassigned pool), server diffs and applies all creates/updates/deletes/moves,
  returns resolved state with real IDs in payload order
* **Roster import endpoint** — `POST /api/meets/:id/roster/import` replaces the client-side
  `applyRosterImport` loop; matches churches by name or shortName (case-insensitive), creates
  missing ones, deduplicates teams by `(division, quizzer-set)` exact match so re-importing an
  unchanged CSV is a no-op
* **Roster export endpoint** — `GET /api/meets/:id/roster/export` returns all churches → teams →
  quizzers in a single join query; replaces the export loop that made 1 + N_churches + N_teams
  sequential requests
* **Team counts on churches list** — `GET /api/meets/:id/churches` now includes `teamCount` per
  church via left-join + group-by; eliminates the N per-church team requests that fired on every
  `QuizMeetView` load

## 0.4.0

### Added

* **Meet join codes (4.4)** — `POST /api/join` resolves admin, coach, and official codes via SHA-256
  hash matching; `POST /api/join/guest` issues short-lived guest JWTs for officials and viewers;
  `GET /api/my-meets` returns all meets the user has joined with their role(s)
* **Superuser dashboard (4.5)** — meet CRUD (`POST/GET/PATCH/DELETE /api/meets`), official code
  management (create/delete/rotate), typed API client with cookie credentials, admin router with
  auth guard and lazy-loaded views, create-meet form on home page
* **Coach roster flow (4.6)** — churches/teams/quizzers API routes with integration tests, coach
  meets list with join form, single-church roster view with team cards, draft-mode editing
  (Save/Discard bar flushes minimal diff to API), drag-to-reorder quizzers and teams, per-team size
  and division-order warnings, inline division select, quizzer rename via pencil icon
* **Role model and dashboard (4.6a)** — per-church coach codes, meet-scoped admin role
  (`admin_memberships`/`coach_memberships` tables), consolidated `QuizMeetView` dashboard replacing
  separate admin page, access dialog with member list and individual revocation, church name editing
  (`PATCH /api/churches/:churchId`), `DELETE /api/churches/:churchId` with cascade
* **Divisions** — `divisions` JSON column on `quiz_meets`, exposed on create/patch/format; pill tags
  on dashboard with inline add/remove editing
* **Viewer-code slug URLs** — meet routes use the admin-set `viewerCode` as a human-readable slug
  (`/fall-2025` instead of `/meets/1`); `GET /api/meets/:id` accepts slug or numeric ID
* **Roster CSV import/export** — admin can import a tournament roster from CSV (4-column or legacy
  8-column format) and export the current roster back to CSV; duplicate detection on re-import
* **Copy and share buttons** — viewer code row shows hover-revealed copy (clipboard) and share (Web
  Share API with URL fallback) icons
* **Multi-day meets** — `date_from` + `date_to` on `quiz_meets` (replaces single `date`)
* **Portal unit tests** — vitest + jsdom setup for `@qzr/web`; tests for `rosterCsv`, `api` client,
  router guards, and `meetAccess` helpers
* **Meet access helpers** — `coachChurchIds`, `isAdminOrSuperuser`, `canAccessChurchRoster`
  extracted to `meetAccess.ts` with full test coverage

### Changed

* **Renamed admin → superuser** throughout codebase (API, shared enums, portal, tests) to
  distinguish account-level superusers from meet-scoped admins
* **Redesigned meet edit form** — flat unlabeled inputs replaced with a structured card: labeled
  fields, side-by-side date pickers, viewer-code URL-change hint, divisions tag editor, field order
  matching the display layout
* **Team card grid** — unified pool and team cards into a single 4-column CSS grid; cards stretch to
  fill available width with consistent min-height (~5 quizzers)
* **Church name display** — responsive CSS truncation with full name + short name in parentheses;
  pencil icon appears on hover for inline editing
* **Division pills** — smaller font and tighter padding for subtler metadata appearance
* **Viewer code on its own line** — separated from divisions in the meet header
* **Church shortName optional** — defaults to full name when omitted on create
* **Home page** — redesigned with QuizMeets list and join form as primary content; scoresheet
  section secondary
* **Roster access gating** — Roster button only visible to admins and the church's own coach;
  unauthorized users redirected from teams view
* **Sign-in preserves page** — OAuth callback returns to the page the user was on, not `/`
* **Unified monorepo versioning** — bump script now updates all package.json files and
  tauri.conf.json in one step

### Infrastructure

* Session middleware reads Better Auth cookies; `requireAuth` (401) and `requireSuperuser` (403)
  guards
* Code hashing and generation utilities (`lib/codes.ts`)
* Guest JWT signing via `jose` + Web Crypto
* `sql.js` replaces `better-sqlite3` for in-memory test DB
* Drizzle migrations regenerated from clean schema
* `@qzr/web`, `@qzr/api`, `@qzr/shared` versions synced to monorepo version

### Fixed

* Sign-in redirected to API server after OAuth callback instead of web app
* `GET /api/meets/:id` was unrestricted — now requires meet membership
* Admin code `clearMembers` restricted to superuser only
* Team number auto-increments per-church (was per-church-per-division)
* Add-quizzer form sentinel collision between pool and first temp team
* Quizzer reorder now marks draft dirty and is restored on discard
* Team drag shows correct before/after insert indicator based on cursor position
* Long team names truncate with ellipsis; team number always visible

## 0.3.3

### Fixed

* Cloudflare Pages was intercepting `/api/*` with a 503 before the Worker route could handle it —
  added `_routes.json` to exclude `/api/*` from Pages

## 0.3.2

### Fixed

* Auth client used an invalid relative URL in production — now falls back to
  `window.location.origin` so Better Auth always receives a valid absolute base URL
* OAuth social sign-in redirected to the API server after callback instead of the web app —
  `callbackURL` now uses `window.location.origin`

## 0.3.1

### Fixed

* API now served at `www.versevault.ca/api/*` (same origin as the web app) via a Cloudflare Worker
  route, eliminating all cross-origin CORS issues in production
* CORS middleware restricted to localhost only — no longer needed in production
* `bump-version.mjs` used `bumpToml` on `tauri.conf.json` (which is JSON) — switched to `bumpJson`
* Removed pre-push type-check hook

## 0.3.0

### Added

* **Authentication** — sign in with GitHub, Google, or email/password via
  [Better Auth](https://better-auth.com)
* **SignInMenu** — popover in the portal header with provider picker and inline email/password form
  (sign-in / create-account toggle)
* Cookie-based sessions — no localStorage JWTs, no redirect dance
* Account linking for GitHub and Google (both verify email addresses)
* `role` additionalField on user (`normal` by default, not user-settable; `admin` provisioned
  out-of-band)
* Drizzle schema migrated to Better Auth tables (`user`, `session`, `account`, `verification`); FK
  columns updated from integer to text UUID

### Infrastructure

* `better-auth` replaces `arctic` — OAuth, email/password, sessions, and account linking in one
  library
* Hand-rolled `routes/auth.ts`, `routes/me.ts`, `lib/jwt.ts`, `lib/upsertAccount.ts` removed
* `JWT_SECRET` replaced by `BETTER_AUTH_SECRET` (≥ 32 chars)
* CI deploy workflow applies D1 migrations before deploying the Worker

## 0.2.0

### Added

* Monorepo conversion — pnpm workspaces with `apps/scoresheet`, `apps/web`, `packages/shared`,
  `packages/api`
* Portal app (`apps/web`) — Vue 3 + vue-router landing page at `www.versevault.ca`
* API (`packages/api`) — Hono + Cloudflare Workers + D1 + Drizzle; `GET /health`; full schema
* Shared package (`packages/shared`) — QuizFile TypeBox schema and role enums extracted
* Combined build and deploy (`pnpm build:all`, `pnpm deploy`) — scoresheet nested under portal

## 0.1.1

### Fixed

* Tauri native builds now work (correct Vite base/outDir for Tauri vs web, renamed binary from `app`
  to `qzr-sheet`, fixed frontendDist path)
* Linux X11 env vars moved to `pnpm tauri:linux-x11` script so CI builds work on Windows
* ESLint no longer lints `scripts/` directory; removed `any` casts in `fileIO.ts`

### Added

* Version number and links footer below the scoresheet table
* `workflow_dispatch` trigger on release workflow for manual build testing
* MIT license and NOTICE file for third-party rule documents
* `scripts/bump-version.mjs` to sync version across `package.json` and `tauri.conf.json`

## 0.1.0

Initial release.

### Features

* **Live scoring** — running totals, per-quizzer stats (quiz-out, error-out, foul-out), running
  total annotations (3rd/4th/5th quizzer bonus, quiz-out bonus, free error, foul deduction)
* **Question types** — inline INT/FTV/REF/MA/Q/SIT selector per column header
* **A/B columns** — Q16–20 sub-columns auto show/hide based on errors, with enter animation
* **Overtime** — toggle enables extra rounds; columns appear when tied scores require them
* **Placement points** — 1st/2nd/3rd calculated after completion, with tied-placement support
* **Validation** — invalid cells pulse red with tooltip reasons; column headers pulse on errors
* **Greyed-out cells** — disabled for answered questions, toss-up teams, after-out quizzers, and
  fouled-on-question situations
* **Keyboard navigation** — arrow keys, letter shortcuts (c/e/f/b/m), Enter/Space opens selector,
  Escape clears; focus indicators only show during keyboard use
* **Drag-drop reordering** — pointer-event drag to reorder quizzers within a team
* **Undo/redo** — Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, capped at 100 entries
* **Editable names** — inline team and quizzer name fields sized to content
* **Save/load JSON** — Ctrl+S / Ctrl+O; native file dialog in Tauri, browser fallbacks
* **ODS export/import** — fill a LibreOffice template with quiz data, or import a filled ODS back
* **Auto-save** — debounced persist to localStorage; restored on startup
* **Offline PWA** — installable from any browser, full offline support via Workbox
* **Sticky headers + touch panning** — thead and name column stay fixed; smooth 2-axis scroll
* **Dark/light theme** toggle

### Infrastructure

* Tauri 2 + Vue 3 + Vite + TypeScript
* CI: type-check, lint, unit tests on every push/PR
* Web deploy to Cloudflare Pages on tag push
* Native release builds (Linux, Windows, macOS) via GitHub Actions on tag push
