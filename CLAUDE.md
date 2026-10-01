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
specs/          # Spec Kit artefacts, one NNN-slug/ per feature (spec, plan, tasks)
.specify/       # Spec Kit scaffolding: templates, shell helpers, constitution
```

See `docs/architecture.md` for full detail on internals, data flow, and design decisions.

`.specify/` is vendored by the Specify CLI, which rewrites `scripts/` and `templates/*.md` on every
refresh. Customise through `.specify/templates/overrides/<name>.md` rather than editing them in
place.

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
pnpm bump <pkg> <ver>   # Bump a single package: scoresheet | web | api | shared
```

The legacy `pnpm deploy` (build everything locally + `wrangler pages deploy`) still exists as an
emergency-only escape hatch. Day-to-day deploys are driven by per-package `version` bumps on master
— see "Releasing" in [CONTRIBUTING.md](./CONTRIBUTING.md).

### CodeCompanion project commands

`.codecompanion-commands.json` exposes these to CodeCompanion (Neovim) as MCP tools. They don't
exist in Claude Code; run the `pnpm` aliases above instead.

* `run_test` — run unit tests to verify changes
* `run_format` — run Prettier after editing files
* `run_lint` — check for lint errors
* `run_type-check` — run `vue-tsc` / `tsc`
* `run_install` — install dependencies after touching `package.json`
* `run_generate` — generate Drizzle migrations after schema changes
* `run_migrate-local` — apply migrations to local D1

Dev servers (`pnpm dev`, `pnpm dev:all`, etc.) are long-running and should not be started from here.

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md) holds the mechanics: hooks, git conventions, commit format,
contract package versioning, and releasing. Read it before committing; its rules aren't repeated
here. What only applies to agents:

* Ask before opening, closing, or splitting a PR.
* Always run pnpm commands from the repo root using root-level aliases (e.g. `pnpm test:unit`, not
  `pnpm --filter scoresheet test:unit`) — keeps commands predictable for auto-approval.

**`git rebase -i` is unavailable in Claude Code** (no interactive input). For targeted squashes,
`git cherry-pick --no-commit <a> <b> <c>` followed by a single `git commit` collapses a contiguous
group; for wider restructures, `git reset --soft <base>` then re-stage and re-commit in groups.
Fixup autosquash still works; see CONTRIBUTING "Rewriting history".

## Spec-driven development

Feature-sized work runs through the `speckit-*` skills (`/speckit-specify`, `/speckit-plan`,
`/speckit-tasks`, `/speckit-implement`), writing into `specs/<NNN-slug>/`. `/speckit-clarify` before
planning de-risks an ambiguous spec, and `/speckit-analyze` cross-checks the three artefacts before
implementation starts. Run `/speckit-analyze` before every `/speckit-implement`, even when asked to
just "continue", unless the user says it already ran or to skip it. Small fixes and one-commit
changes skip the pipeline.

Those commands gate against `.specify/memory/constitution.md`. It states principles;
[CONTRIBUTING.md](./CONTRIBUTING.md) holds the mechanics they compile down to, and this file the
runtime guidance for agents. Where they disagree, fix the operational file rather than working
around it.

Spec Kit is branch-agnostic: `create-new-feature.sh` invokes git nowhere, and its `NNN-slug` string
names the `specs/` directory rather than a branch. Keep using `type/short-slug` branches. Commit
each artefact as it lands (`docs: spec <feature>`, `docs: plan <feature>`,
`docs: break <feature> into tasks`).

## Scope discipline

When working on a feature and you notice something nearby that's bad, awkward, or should be
changed/fixed — **stop and check with the user before acting**. Offer options:

* address it now as a separate change (commit it before continuing the feature), or
* leave it and document it (TODO comment, issue, or ROADMAP entry) and continue.

Don't silently fix it as part of the current feature — it muddies the diff, and the user may have
context (deliberate choice, planned rework, scope concerns) you don't. And don't just ignore it —
surface it so the user can decide.

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
* **A stale Vite watcher looks like a CSS bug.** Long-running dev servers (especially once Linux
  hits its inotify limit) silently stop picking up edits. If a visual change "didn't work" but the
  file on disk is right, fetch the served stylesheet (`curl` the `?vue&type=style` URL) and compare
  before editing again; if it's stale, ask the user to restart `pnpm dev:all`.
* **Never hand-write or edit migration files.** Always run `pnpm --filter @qzr/api db:generate` to
  generate migrations from the schema diff. If the generated SQL won't work (e.g. `ADD NOT NULL` on
  existing rows), fix the schema design instead — make the column nullable, provide a default, or
  split into two migrations. The `migrations/meta/_journal.json` must stay in sync.
* **A fresh clone cannot resume a committed Spec Kit feature.** `.specify/feature.json` is the only
  feature-context source the scripts accept, and Spec Kit gitignores it as machine-local state.
  Every speckit command fails with "Feature directory not found" until you
  `export SPECIFY_FEATURE_DIRECTORY=specs/<NNN-slug>` or re-run `/speckit-specify`.
* **dprint rewrites Spec Kit's checkboxes, so `specs/**/tasks.md` and `specs/**/checklists/` are
  excluded.** `unorderedListKind: "asterisks"` turns `- [ ]` into `* [ ]`, and `/speckit-implement`
  and `/speckit-converge` read task state from the hyphen form. The rewrite is silent and still
  renders fine, so the damage only shows when a speckit command finds no tasks. Prose artefacts in
  `specs/` carry no checkboxes and stay linted.
* **Vendored Spec Kit files are exempt from dprint and typos, narrowly.** `.specify/scripts/`,
  `.specify/templates/`, and `.claude/skills/speckit-*/` are rewritten on every `specify` refresh,
  so any fix would be undone. `.specify/memory/constitution.md` and `.specify/templates/overrides/`
  are project-authored and stay linted. Don't widen either exclusion to `.specify/**`.

## Reference Docs

When working on scoring logic, rules, or architecture, read the relevant file first:

* `CONTRIBUTING.md`: hooks, git conventions, commit format, contract versioning, releasing
* `.specify/memory/constitution.md`: project constitution, the principles the `speckit-*` commands
  gate against
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
* `docs/auth.md`: Better Auth setup, account types, OAuth and Tauri flows, security
* `docs/roles-and-access.md`: meet-scoped roles, codes, join flow, guest tokens
* `docs/data-model.md`: full schema, memberships, quizzer identity
* `docs/ods-format.md`: the LibreOffice template layout that ODS export and import target
