# Quizmeet Scoresheet

A digital scoresheet for Quizmeet tournaments. Replaces paper sheets and spreadsheets with a modern,
portable app.

See [ROADMAP.md](./ROADMAP.md) for the feature breakdown and implementation plan.

## Commands

```sh
pnpm dev          # Vite dev server (web only)
pnpm tauri dev    # Tauri native window (hot-reload)
pnpm test:unit    # Vitest unit tests
pnpm type-check   # vue-tsc (also runs as part of build)
pnpm lint         # ESLint (also runs on pre-commit)
pnpm format       # Prettier (no semi, single quotes, 100 col)
pnpm build:web && wrangler pages deploy dist --project-name versevault-www --branch master  # Deploy to www.versevault.ca
```

## Project Structure

```
src/
  types/scoresheet.ts          # Core types: CellValue, Column, Quiz, Team, Quizzer
  stores/quizStore.ts           # In-memory store, cell grid derivation
  scoring/
    scoreTeam.ts               # Per-team scoring (pure function)
    greyedOut.ts               # Disabled/tossed-up/foul-cascade cell state
    columnVisibility.ts        # Which columns render (A/B auto show/hide)
    validation.ts              # ValidationCode enum + validateCells()
    overtime.ts                # OT eligibility, round count, checkpoint scores
    placement.ts               # 1st/2nd/3rd placement derivation
    helpers.ts                 # Pure cell-grid query helpers
  composables/
    useScoresheet.ts           # Vue reactivity layer over store + scoring
    useHistory.ts              # Generic undo/redo command stack
    useCellSelector.ts         # Cell selector popup state
    useKeyboardNav.ts          # Keyboard navigation and shortcuts
    useDragReorder.ts          # Pointer-event drag reorder
  components/Scoresheet.vue    # Single-component UI
src-tauri/                      # Tauri 2 Rust backend
docs/
  scoring-rules-explained.md  # Full domain rules reference
  architecture.md              # Data flow and design decisions
```

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI
with `vue-tsc` for type checking. In editors, we need
[Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript
language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
pnpm i
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
pnpm test:unit
```
