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

See `docs/auth-proposal.md` for the full design — architecture, API stack, security, data model, and
OAuth flows.

### 4.0 Monorepo conversion

Restructure the repo into a pnpm workspace monorepo before adding new packages.

#### Move under `apps/scoresheet/`

* `src/`, `public/`, `index.html`
* `vite.config.ts`, `vitest.config.ts`, `pwa-assets.config.ts`
* `tsconfig.app.json`, `tsconfig.vitest.json`
* `src-tauri/` (relative paths in `tauri.conf.json` updated accordingly)
* Own `package.json` with the app's dependencies

#### Stay at root

* `package.json` (workspace root — scripts, shared devDependencies)
* `pnpm-workspace.yaml` (new)
* `eslint.config.ts`, `.prettierrc.json`, `commitlint.config.js` (shared tooling)
* `tsconfig.json`, `tsconfig.node.json` (base configs that packages extend)
* `.github/` (workflows updated for new paths)
* `docs/`, `ROADMAP.md`, `README.md`

#### Scaffold new packages

* `packages/shared/` — `package.json`, `tsconfig.json`, extract `QuizFile` schema and shared types
* `packages/api/` — `package.json`, `tsconfig.json`, `wrangler.toml`, minimal Hono app
* `apps/web/` — placeholder for the portal

#### Config updates

* `tauri.conf.json` — `$schema` path, `beforeDevCommand`, `beforeBuildCommand`, `frontendDist`
* CI workflows — `working-directory` for build steps, updated deploy paths
* Root `package.json` — workspace scripts (e.g. `pnpm --filter scoresheet dev`)

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
Deploy target: `api.versevault.ca/`.

### 4.3 Authentication ✓

OAuth sign-in with GitHub and Google. Platform-aware auth client — popup on web,
`tauri-plugin-oauth` on desktop (planned). `arctic` v3 handles the provider dance on the API. First
login creates a `normal` account. Auto-link on matching verified email supports multiple providers
per account via a separate `oauth_accounts` table. JWT issued on sign-in (HS256, 1h TTL). Signed-in
state shown in the portal header; `GET /me` returns the current account.

### 4.3.1 Auth migration to Better Auth

Replace the hand-rolled Arctic + JWT auth with [Better Auth](https://better-auth.com). Motivation:
email/password support with password reset flow, which Arctic doesn't provide.

What changes:

* `better-auth` replaces `arctic`, all of `src/routes/auth.ts`, `src/routes/me.ts`,
  `src/lib/upsertAccount.ts`, and `src/lib/jwt.ts`
* Better Auth mounted at `/api/auth/*` in Hono; handles OAuth (GitHub, Google), email/password,
  sessions, account linking, and password reset out of the box
* DB schema: `accounts` + `oauth_accounts` tables replaced by Better Auth's `user`, `session`,
  `account`, `verification` tables; app FK references updated to `user.id`; `role` added as an
  `additionalField` on `user`
* Frontend `useAuth` composable rewritten to use `better-auth/vue` client (cookie sessions replace
  localStorage JWTs); `AuthDoneView` and the redirect dance removed
* Guest JWTs for officials and viewers remain custom — Better Auth handles user auth only

### 4.4 Meet join codes

Enter a code (or follow a join link) to gain a meet-scoped role: `head_coach`, `official`, or
`viewer`. Officials and viewers can use guest JWTs without creating an account.

### 4.5 Official flow

Load assigned quiz details (teams, quizzers, room) from the API and pre-populate the scoresheet. Two
entry points: portal schedule click (`/scoresheet/?quiz=id`) or scoresheet sign-in + quiz picker
modal. Submit completed `QuizFile` results back to the server.

### 4.6 Coach flow

Create and manage churches, teams, and quizzer rosters for a meet. Link quizzers to historical
identities for cross-meet career stats.

### 4.7 Viewer access

Read-only view of meet standings, stats, and schedules. No account required — guest JWT issued via
viewer code or join link.

### 4.8 Admin dashboard

Create and manage quiz meets. Generate and rotate coach, official, and viewer codes. Review
submitted results and manage accounts.
