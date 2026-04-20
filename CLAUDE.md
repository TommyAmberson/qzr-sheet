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
pnpm lint               # ESLint (all packages)
pnpm deploy             # Build all + deploy to CF Pages + CF Worker
```

### Available as MCP tools

These commands are wired up as project commands and should be used proactively after making changes:

* `run_test` — run unit tests to verify changes
* `run_format` — run Prettier after editing files
* `run_lint` — check for lint errors
* `run_type-check` — run `vue-tsc` / `tsc`
* `run_install` — install dependencies after touching `package.json`
* `run_generate` — generate Drizzle migrations after schema changes
* `run_migrate-local` — apply migrations to local D1

Dev servers (`pnpm dev`, `pnpm dev:all`, etc.) are long-running and should not be started from here.

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

See `docs/architecture.md` for full detail on internals, data flow, and design decisions.

```
apps/
  scoresheet/   # Vue 3 + Tauri 2 — offline-first scoring tool
  web/          # Portal — coach roster mgmt, admin dashboard
packages/
  shared/       # QuizFile schema, role enums, shared API types
  api/          # Hono + D1 + Drizzle (Cloudflare Workers)
```

## Key Conventions

* Scoring functions are **pure** — `cells[teamIdx][seatIdx][colIdx]` in, result out. No Vue.
* Column keys: `"1"`–`"15"`, `"16"`/`"16A"`/`"16B"` through `"20B"`, `"21"`+ for overtime.
* Tests live in `__tests__/` subdirectories next to the code they test.
* Slight preference for writing tests before features.
* Redundant comments are not helpful. Comments that simply say "what" is happening when the code is
  obvious should be extremely brief or omitted. Prefer comments that explain "why" or complex logic.
* Commits should be atomic and self-contained, with conventional commit messages. Commits should not
  be too large or too small. Use branches for larger features or refactors.
* Work on feature branches, not directly on master. Merge when ready.
* Commit history should be clean and readable — it's the primary record of why each change happened,
  so favor history that's easy to follow and easy to bisect.
* Use merge commits, not squash. When merging a PR, use `gh pr merge <N> --merge --delete-branch`
  (not `--squash`) — the individual branch commits should land on master so `git log` shows the
  actual progression.
* Rewriting history on feature branches is fine and often encouraged (rebase, amend, reorder, squash
  fixups, force-push with `--force-with-lease`) when it produces a cleaner, more readable series
  before merging. Never rewrite history on master — once a commit is on master, it stays.
* Always run pnpm commands from the repo root using root-level aliases (e.g. `pnpm test:unit`, not
  `pnpm --filter scoresheet test:unit`) — keeps commands predictable for auto-approval.

## Gotchas

* `createQuizStore()` is a factory — no singleton. Call it fresh per test.
* `buildColumns(n)` takes an overtime round count; `n=0` means no OT columns at all.
* `isErrorPoints` is true for Q17–20 and all OT columns — **not** Q16.
* Foul deduction does not stack: 3rd-team-foul + foul-out on the same foul = only −10.
* Drag reorder uses pointer events only (no HTML5 drag API — crashes on Linux/X11).
* **Vue 3 template compiler bug:** multi-statement `@click` handlers without semicolons are rejected
  (vuejs/core#8854). Prettier removes semicolons on format, re-triggering the error. Always extract
  multi-statement handlers to named functions in `<script setup>` instead of inline expressions.
* Auth uses Better Auth cookie sessions — no JWTs for user auth. `BETTER_AUTH_SECRET` must be ≥32
  chars. OAuth callbacks: `/api/auth/callback/github`, `/api/auth/callback/google`.
* **Never hand-write or edit migration files.** Always run `pnpm --filter @qzr/api db:generate` to
  generate migrations from the schema diff. If the generated SQL won't work (e.g. `ADD NOT NULL` on
  existing rows), fix the schema design instead — make the column nullable, provide a default, or
  split into two migrations. The `migrations/meta/_journal.json` must stay in sync.

## Reference Docs

When working on scoring logic, rules, or architecture, read the relevant file first:

* `docs/issue-conventions.md` — labels, titles, AI attribution, and how issues relate to
  `ROADMAP.md`
* `ROADMAP.md` — feature breakdown and implementation plan
* `apps/web/src/views/RoadmapView.vue` — user-facing feature status page; keep in sync with
  ROADMAP.md when features ship (move items from "Coming soon" to "Available now")
* `docs/scoring-rules-explained.md` — cell types, point values,
  toss-up/bonus/A-B/foul/overtime/placement
* `docs/rules.md` — full rules from official pdf
* `docs/architecture.md` — data flow, layer responsibilities, key design decisions
* `docs/auth-proposal.md` — Phase 4 architecture, API stack, security, data model
