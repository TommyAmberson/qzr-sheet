# qzr

Bible Quiz scoresheet app. Tauri 2 + Vue 3 + Vite + TypeScript. Monorepo with pnpm workspaces.

## Commands

```sh
pnpm dev          # Vite dev server (web only)
pnpm tauri dev    # Tauri native window (hot-reload)
pnpm test:unit    # Vitest unit tests
pnpm type-check   # vue-tsc
pnpm format       # Prettier (no semi, single quotes, 100 col)
pnpm build:web && wrangler pages deploy apps/scoresheet/dist --project-name versevault-www --branch master  # Deploy to www.versevault.ca
```

All root scripts delegate to the scoresheet workspace via `pnpm --filter scoresheet`.

## Project Structure

```
apps/
  scoresheet/                    # Vue 3 + Tauri 2 scoresheet app
    src/
      types/scoresheet.ts        # Core types: CellValue, Column, Quiz, Team, Quizzer
      stores/quizStore.ts        # In-memory store, cell grid derivation
      scoring/
        scoreTeam.ts             # Per-team scoring (pure function)
        greyedOut.ts             # Disabled/tossed-up/foul-cascade cell state
        columnVisibility.ts      # Which columns render (A/B auto show/hide)
        validation.ts            # ValidationCode enum + validateCells()
        overtime.ts              # OT eligibility, round count, checkpoint scores
        placement.ts             # 1st/2nd/3rd placement derivation
        helpers.ts               # Pure cell-grid query helpers
      composables/useScoresheet.ts  # Vue reactivity layer over store + scoring
      components/Scoresheet.vue     # Single-component UI
    src-tauri/                   # Tauri 2 Rust backend (minimal, no custom commands yet)
  web/                           # Portal app (planned)
packages/
  shared/                        # Shared types and schemas (planned)
  api/                           # Hono + D1 + Drizzle API (planned)
docs/
  scoring-rules-explained.md     # Cell types, point values, all scoring rules
  architecture.md                # Scoresheet data flow and design decisions
  rules.md                       # Full rules from official pdf
  auth-proposal.md               # Phase 4 architecture, API stack, security
```

## Key Conventions

* Scoring functions are **pure** — `cells[teamIdx][quizzerIdx][colIdx]` in, result out. No Vue.
* Column keys: `"1"`–`"15"`, `"16"`/`"16A"`/`"16B"` through `"20B"`, `"21"`+ for overtime.
* Tests live in `__tests__/` subdirectories next to the code they test.
* Slight preference for writing tests before features.
* Redundant comments are not helpful. Prefer to make the code readable and maintainable instead of
  just adding comments. Only add comments to explain "why" if not immediately obvious, or to explain
  complex logic.
* Commits should be atomic and self-contained, with conventional commit messages. Use branches for
  larger features or refactors.

## Gotchas

* `createQuizStore()` is a factory — no singleton. Call it fresh per test.
* `buildColumns(n)` takes an overtime round count; `n=0` means no OT columns at all.
* `isErrorPoints` is true for Q17–20 and all OT columns — **not** Q16.
* Foul deduction does not stack: 3rd-team-foul + foul-out on the same foul = only −10.
* Drag reorder uses pointer events only (no HTML5 drag API — crashes on Linux/X11).

## Reference Docs

When working on scoring logic, rules, or architecture, read the relevant file first:

* `ROADMAP.md` — feature breakdown and implementation plan
* `docs/scoring-rules-explained.md` — cell types, point values,
  toss-up/bonus/A-B/foul/overtime/placement
* `docs/rules.md` -- full rules from official pdf
* `docs/architecture.md` — data flow, layer responsibilities, key design decisions
* `docs/auth-proposal.md` — Phase 4 architecture, API stack, security, data model
