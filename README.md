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
pnpm dev               # Vite dev server (web only)
pnpm tauri dev         # Tauri native window (hot-reload)
pnpm tauri:linux-x11 dev   # Same, with Linux/X11 GPU workarounds
pnpm test:unit         # Vitest unit tests
pnpm type-check        # vue-tsc
pnpm lint              # ESLint
pnpm format            # Prettier (no semi, single quotes, 100 col)

# Deploy to www.versevault.ca
pnpm build:web && wrangler pages deploy apps/scoresheet/dist --project-name versevault-www --branch master
```

All root scripts delegate to the scoresheet workspace via `pnpm --filter scoresheet`.

## Project Structure

See [docs/architecture.md](./docs/architecture.md) for the full data flow and design decisions. See
[docs/auth-proposal.md](./docs/auth-proposal.md) for the Phase 4 architecture and API design.

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
  web/                           # Portal app (planned — coach, admin, viewer, schedule)
packages/
  shared/                        # Shared types and schemas (planned)
  api/                           # Hono + D1 + Drizzle API (planned)
docs/
  scoring-rules-explained.md     # Cell types, point values, all scoring rules
  architecture.md                # Data flow and design decisions
  rules.md                       # Full rules from the official rulebook PDF
  auth-proposal.md               # Phase 4 architecture, API stack, security
```

## Editor Setup

[Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) is required for TypeScript
type support in `.vue` files.
