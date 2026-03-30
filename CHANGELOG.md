# Changelog

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
