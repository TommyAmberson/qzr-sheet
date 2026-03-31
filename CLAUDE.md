# qzr

Bible Quiz scoresheet app. Tauri 2 + Vue 3 + Vite + TypeScript. Monorepo with pnpm workspaces.

See `README.md` for setup, project structure, and deployment. See `ROADMAP.md` for feature status.

## Commands

```sh
pnpm dev:all            # All three dev servers in parallel (scoresheet :5173, portal :5174, API :8787)
pnpm dev                # Scoresheet only
pnpm dev:web            # Portal only
pnpm dev:api            # API only
pnpm tauri dev          # Tauri native window (hot-reload)
pnpm tauri:linux-x11 dev  # Same, with Linux/X11 GPU workarounds
pnpm test:unit          # Vitest unit tests (all packages, run once)
pnpm test:watch         # Vitest watch mode (all packages, parallel)
pnpm type-check         # vue-tsc / tsc (all packages)
pnpm format             # Prettier (no semi, single quotes, 100 col)
pnpm deploy             # Build all + deploy to CF Pages + CF Worker
```

## Releasing

1. Update `CHANGELOG.md` with a new version section
2. Run:

```sh
pnpm bump x.y.z   # bumps package.json, apps/scoresheet/package.json, tauri.conf.json
git add package.json apps/scoresheet/package.json apps/scoresheet/src-tauri/tauri.conf.json
git commit -m "chore: bump version to x.y.z"
git tag vx.y.z
git push origin master --tags
```

CI deploys on `v*` tags.

## Project Structure

```
apps/
  scoresheet/                    # Vue 3 + Tauri 2 scoresheet app
    src/
      types/scoresheet.ts        # Core types: CellValue, Column, Quiz, Team, Quizzer
      stores/quizStore.ts        # In-memory store, cell grid derivation
      scoring/                   # Pure scoring functions (no Vue)
      composables/useScoresheet.ts
      components/Scoresheet.vue
    src-tauri/
  web/                           # Portal app
    src/
      composables/useAuth.ts     # better-auth/vue client
      components/SignInMenu.vue  # GitHub / Google / email sign-in popover
packages/
  shared/                        # QuizFile schema, role enums, shared API types
  api/                           # Hono + D1 + Drizzle (Cloudflare Workers)
    src/lib/auth.ts              # createAuth(env) — Better Auth instance factory
    .dev.vars.example            # Copy to .dev.vars and fill in for local dev
docs/
  scoring-rules-explained.md
  architecture.md
  rules.md
  auth-proposal.md
```

## Key Conventions

* Scoring functions are **pure** — `cells[teamIdx][quizzerIdx][colIdx]` in, result out. No Vue.
* Column keys: `"1"`–`"15"`, `"16"`/`"16A"`/`"16B"` through `"20B"`, `"21"`+ for overtime.
* Tests live in `__tests__/` subdirectories next to the code they test.
* Slight preference for writing tests before features.
* Redundant comments are not helpful. Only comment to explain "why" or complex logic.
* Commits should be atomic and self-contained, with conventional commit messages. Use branches for
  larger features or refactors.

## Gotchas

* `createQuizStore()` is a factory — no singleton. Call it fresh per test.
* `buildColumns(n)` takes an overtime round count; `n=0` means no OT columns at all.
* `isErrorPoints` is true for Q17–20 and all OT columns — **not** Q16.
* Foul deduction does not stack: 3rd-team-foul + foul-out on the same foul = only −10.
* Drag reorder uses pointer events only (no HTML5 drag API — crashes on Linux/X11).
* Auth uses Better Auth cookie sessions — no JWTs for user auth. `BETTER_AUTH_SECRET` must be ≥32
  chars. OAuth callbacks: `/api/auth/callback/github`, `/api/auth/callback/google`.
* **Never hand-write or edit migration files.** Always run `pnpm --filter @qzr/api db:generate` to
  generate migrations from the schema diff. If the generated SQL won't work (e.g. `ADD NOT NULL` on
  existing rows), fix the schema design instead — make the column nullable, provide a default, or
  split into two migrations. The `migrations/meta/_journal.json` must stay in sync.

## Reference Docs

When working on scoring logic, rules, or architecture, read the relevant file first:

* `ROADMAP.md` — feature breakdown and implementation plan
* `docs/scoring-rules-explained.md` — cell types, point values,
  toss-up/bonus/A-B/foul/overtime/placement
* `docs/rules.md` — full rules from official pdf
* `docs/architecture.md` — data flow, layer responsibilities, key design decisions
* `docs/auth-proposal.md` — Phase 4 architecture, API stack, security, data model
