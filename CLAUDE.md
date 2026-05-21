# qzr

Bible Quiz scoresheet app. Tauri 2 + Vue 3 + Vite + TypeScript. Monorepo with pnpm workspaces.

See `README.md` for setup and deployment. See `ROADMAP.md` for feature status.

## Project layout

```
apps/
  scoresheet/   # Vue 3 + Tauri 2 — offline-first scoring tool
  web/          # Portal — coach roster mgmt, admin dashboard
packages/
  shared/       # QuizFile schema, role enums, shared API types
  ui/           # Workspace-internal Vue components
  api/          # Hono + D1 + Drizzle (Cloudflare Workers)
```

See `docs/architecture.md` for full detail on internals, data flow, and design decisions.

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

## Pre-commit checks

Hooks are wired via `simple-git-hooks` + `lint-staged` and installed by `pnpm install` (see the
`postinstall` script in `package.json`). The `pre-commit` hook runs `lint-staged` — which formats
TS/Vue/CSS with Prettier, fixes lint with ESLint, and runs `dprint` on markdown / Dockerfiles. The
`commit-msg` hook runs `commitlint` against the conventional-commits config (see
`commitlint.config.js` for the scope-enum and length rules below).

## Git conventions

* Commits must be atomic and single-responsibility — one logical change per commit.
* Commit as you go: after each logical chunk compiles and tests pass, commit it — don't batch at the
  end.
* Do not add `Co-Authored-By` lines.
* Work on feature branches, not directly on master.
* Always run pnpm commands from the repo root using root-level aliases (e.g. `pnpm test:unit`, not
  `pnpm --filter scoresheet test:unit`) — keeps commands predictable for auto-approval.

### Merging PRs

* Always use a merge commit, never squash: `gh pr merge <N> --merge --delete-branch`. The individual
  branch commits must land on master so `git log` shows the actual progression.
* Merge-commit subjects follow conventional-commits, same as regular commits — typically
  `chore: merge <branch-name>`. For local merges, set this via `git merge --no-ff -m "..."`. For
  PRs, pass `--subject "chore: merge <branch>"` to `gh pr merge` (or edit before confirming) —
  GitHub's default `Merge pull request #N from …` template doesn't conform to commitlint.

### Rewriting history

* **Feature branches:** rewriting is fine and often encouraged (rebase, amend, reorder, squash
  fixups, `git push --force-with-lease`) when it produces a cleaner, more readable series _before_
  merging.
* **Master:** never rewrite history. Once a commit is on master, it stays.
* **What to squash:** "changed my mind from X to Y" iterations where the intermediate state never
  ships. Keep small atomic commits that each did meaningful incremental work — the goal is that
  `git blame` on any given line lands on a commit whose message explains the change.
* **`git rebase -i` is unavailable in Claude Code** (no interactive input). For targeted squashes,
  `git cherry-pick --no-commit <a> <b> <c>` followed by a single `git commit` collapses a contiguous
  group; for wider restructures, `git reset --soft <base>` then re-stage and re-commit in groups.

### Commit message format ([Conventional Commits](https://www.conventionalcommits.org/))

```
<type>(<scope>): <short subject in lowercase>

<wrapped body explaining why, not what (the diff shows what)>
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `style`, `revert`, `perf`, `build`.

Scopes: `scoresheet`, `web`, `api`, `shared`, `ui`, `tauri`, `ci`, `deps`. Omit the scope for
cross-cutting changes (e.g. `chore: bump version to 0.9.2`).

Subject in lowercase, no trailing period, imperative mood ("add X", not "added X"), and **≤ 50
characters** including the type/scope prefix. Body wrapped at ~72 cols, focuses on the why. Mark
breaking changes with `!` after the type/scope (`feat(api)!: …`) — wire format, file format, or
public-type changes.

## Contract package versioning

`packages/shared` (QuizFile schema, role enums, shared API types) is a contract across consumers —
the API today, the scoresheet PWA + Tauri client, and the web portal. Same `@qzr/shared` version
across consumers means same observable wire/state behaviour. Discipline for when this matters lives
in `docs/release-process.md` once per-package deploys ship (PR pending) — until then, this section
is a stub.

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

## Key Conventions

* Scoring functions are **pure** — `cells[teamIdx][seatIdx][colIdx]` in, result out. No Vue.
* Column keys: `"1"`–`"15"`, `"16"`/`"16A"`/`"16B"` through `"20B"`, `"21"`+ for overtime.
* Tests live in `__tests__/` subdirectories next to the code they test.
* Slight preference for writing tests before features.
* Redundant inline comments are not helpful. Comments that simply say "what" is happening when the
  code is obvious should be brief or perhaps even omitted. Prefer comments that explain "why" or
  clarify complex logic. Docstrings should be brief and focused on info that is not obvious from the
  signature and would be useful to consumers. (but don't be too picky about removing comments)

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
* `docs/scheduling.md` — meet scheduling design: prelims, stats break, elims, data model, builder UX
* `docs/example-winkler-2026.md` — worked example from a sister-org meet draw spreadsheet;
  inspiration source for scheduling design where `docs/rules.md` underspecifies how meets actually
  run (multi-bracket elims, lateness handling, slot pitches, etc.). Adapt or diverge as needed
* `docs/architecture.md` — data flow, layer responsibilities, key design decisions
* `docs/auth-proposal.md` — Phase 4 architecture, API stack, security, data model
