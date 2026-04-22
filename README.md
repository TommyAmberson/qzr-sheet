# qzr

Digital scoresheet for Quizmeet Bible Quiz tournaments. Replaces paper sheets and spreadsheets with
a fast, portable app that runs natively on Windows/macOS/Linux (via [Tauri 2](https://tauri.app))
and in any browser as an installable PWA. Monorepo with a planned web portal and API for quiz meet
management.

**Live web app:** [www.versevault.ca/scoresheet](https://www.versevault.ca/scoresheet)

## Features

> See [ROADMAP.md](./ROADMAP.md) for the full feature breakdown and what's planned next.

* **Live scoring** — running totals, per-quizzer stats (quiz-out, error-out, foul-out), and running
  total annotations (bonus points, foul deductions, free errors)
* **A/B columns** — Q16–20 sub-columns auto show/hide based on errors, with enter animation
* **Overtime** — toggle enables extra rounds; columns appear when tied scores require them
* **Placement points** — 1st/2nd/3rd calculated after completion, with tied-placement support
* **Question types** — inline INT/FTV/REF/MA/Q/SIT selector per column header
* **Validation** — invalid cells pulse red with tooltip reasons; headers pulse when any cell in that
  column has an error
* **Keyboard navigation** — arrow keys, letter shortcuts (c/e/f/b/m), undo hotkeys
* **Drag-drop reordering** — reorder quizzers within a team
* **Undo/redo** — Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, capped at 100 entries
* **Save/load JSON** — Ctrl+S / Ctrl+O; native file dialog in Tauri, `showSaveFilePicker` in Chrome,
  `<a>` download fallback
* **ODS export/import** — fill a LibreOffice Calc template (.ots/.ods) with quiz data, or import a
  filled ODS back into the app
* **Auto-save** — debounced persist to `localStorage` on every change; restored on startup
* **Offline PWA** — installable from any browser, full offline support via Workbox
* **Sticky headers + touch panning** — thead and name column stay fixed; smooth 2-axis touch scroll

## Setup

```sh
pnpm i
```

## Commands

```sh
pnpm dev:all               # All three dev servers in parallel (scoresheet + portal + API)
pnpm dev                   # Scoresheet only
pnpm dev:web               # Portal only
pnpm dev:api               # API only (requires wrangler login)
pnpm tauri dev             # Tauri native window (hot-reload)
pnpm tauri:linux-x11 dev   # Same, with Linux/X11 GPU workarounds

pnpm test:unit         # Vitest unit tests (scoresheet + api)
pnpm type-check        # vue-tsc / tsc (all four packages)
pnpm lint              # ESLint
pnpm format            # Prettier (no semi, single quotes, 100 col)

# Deploy both apps to www.versevault.ca
pnpm deploy
# Or build the combined output manually:
pnpm build:all && wrangler pages deploy apps/web/dist --project-name versevault-www --branch master
```

All root scripts delegate to the relevant workspace packages via `pnpm --filter`.

## Project Structure

See [docs/architecture.md](./docs/architecture.md) for the full data flow and design decisions. For
auth, roles, and the data model see the docs below.

```
apps/
  scoresheet/                    # Vue 3 + Tauri 2 scoresheet app
    src/
      types/                     # Core types
      stores/                    # In-memory quiz store
      scoring/                   # Pure scoring, validation, placement, greyed-out logic
      composables/               # Vue reactivity layer, undo/redo, keyboard nav, drag reorder
      export/                    # ODS template fill + import
      persistence/               # JSON schema, file I/O, localStorage auto-save
      components/                # Scoresheet.vue (single-component UI)
    src-tauri/                   # Tauri 2 Rust backend
  web/                           # Portal app (landing page; coach, admin, viewer views planned)
packages/
  shared/                        # QuizFile schema, role enums, shared API types
  api/                           # Hono + D1 + Drizzle API (Cloudflare Workers)
docs/
  scoring-rules-explained.md     # Cell types, point values, all scoring rules
  architecture.md                # Monorepo structure, API stack, scoresheet internals
  rules.md                       # Full rules from the official rulebook PDF
  scheduling.md                  # Meet scheduling: prelims, stats break, elims, data model
  auth.md                        # Auth implementation, OAuth, Tauri, security
  roles-and-access.md            # Meet roles, codes, join flow, rotation policy
  data-model.md                  # Full schema, memberships, quizzer identity
```

## Releasing

1. Merge the feature branch to `master`
2. `pnpm bump x.y.z` — bumps version in all `package.json` files, and `tauri.conf.json`
3. Stage and commit the changed files: `git commit -m "chore: bump version to x.y.z"`
4. Tag: `git tag vx.y.z`
5. Push: `git push origin master --tags`

The `deploy` CI workflow triggers on `v*` tags and:

* Runs `db:migrate:remote` against the live D1 database
* Deploys the Cloudflare Worker (routed at `www.versevault.ca/api/*`)
* Builds and deploys the web + scoresheet apps to `www.versevault.ca`

The Worker secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`) must be set via `wrangler secret put` before the first
deploy. They are not stored in source control — use `packages/api/.dev.vars.example` as a reference.

### Local auth setup

1. Copy `.dev.vars.example` to `.dev.vars` in `packages/api/`
2. Fill in `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — create an OAuth App at
   https://github.com/settings/developers with callback URL
   `http://localhost:8787/api/auth/callback/github`
3. Fill in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — create credentials at
   https://console.developers.google.com with callback URL
   `http://localhost:8787/api/auth/callback/google`
4. `BETTER_AUTH_SECRET` can be any string ≥ 32 characters for local dev (the example value is fine)
5. Run `pnpm --filter @qzr/api db:migrate:local` to apply migrations to the local D1 instance
6. `pnpm dev:all` — API at `:8787`, portal at `:5174`, scoresheet at `:5173`

## Editor Setup

[Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) is required for TypeScript
type support in `.vue` files.
