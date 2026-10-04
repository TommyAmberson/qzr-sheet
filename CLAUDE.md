# qzr

Bible Quiz scoresheet app. Tauri 2 + Vue 3 + Vite + TypeScript. Monorepo with pnpm workspaces.

See `README.md` for setup and deployment. See `ROADMAP.md` for feature status.

## Project layout

```
apps/
  scoresheet/   # Vue 3 + Tauri 2 — offline-first scoring tool
  web/          # Portal — coach roster mgmt, admin dashboard
packages/
  shared/       # QuizFile schema, scoring, role enums, shared API types
  ui/           # Workspace-internal Vue components
  api/          # Hono + D1 + Drizzle (Cloudflare Workers)
specs/          # Spec Kit artefacts, one NNN-slug/ per feature (spec, plan, tasks)
.specify/       # Spec Kit scaffolding: templates, shell helpers, constitution
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
pnpm bump <pkg> <ver>   # Bump a single package: scoresheet | web | api | shared
```

The legacy `pnpm deploy` (build everything locally + `wrangler deploy` for `qzr-web`) still exists
as an emergency-only escape hatch. Day-to-day deploys are driven by per-package `version` bumps on
master — see "Releasing" in [CONTRIBUTING.md](./CONTRIBUTING.md).

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

Always run pnpm commands from the repo root using root-level aliases (e.g. `pnpm test:unit`, not
`pnpm --filter scoresheet test:unit`), which keeps commands predictable for auto-approval.

<!-- BEGIN shared agent workflow: keep identical in qzr-sheet and verse-vault -->

## Git workflow

[CONTRIBUTING.md](./CONTRIBUTING.md) holds the mechanics: hooks, branches, commit format, PRs,
merging, history rewriting, versioning, and releasing. Read it before committing; its rules aren't
repeated here. On top of it:

* Commit as you go on a `type/short-slug` branch, without waiting to be asked.
* Ask before opening, closing, or splitting a PR.
* `git rebase -i` is unavailable in Claude Code (no interactive input). For a contiguous squash,
  `git cherry-pick --no-commit <a> <b> <c>`, then a single `git commit`. For a wider restructure,
  `git reset --soft <base>`, then re-stage and re-commit in groups. Autosquash still works
  non-interactively, `git -c sequence.editor=: rebase -i --autosquash master`, because `fixup!`
  commits discard their own message, so no editor opens; see CONTRIBUTING "Rewriting history".

## Scope discipline

When you notice something nearby that's bad, awkward, or wrong while working on a feature, **stop
and check with the user before acting**. Offer to either:

* fix it now as a separate commit before continuing the feature, or
* record it (TODO comment, issue, or ROADMAP entry) and carry on.

Don't fold it silently into the current change: it muddies the diff, and the user may have context
(a deliberate choice, planned rework) you don't. Don't ignore it either.

## Spec-driven development

Feature-sized work runs through the `speckit-*` skills (`/speckit-specify`, `/speckit-plan`,
`/speckit-tasks`, `/speckit-implement`), writing into `specs/<NNN-slug>/`. `/speckit-clarify` before
planning de-risks an ambiguous spec, and `/speckit-analyze` cross-checks the three artifacts before
implementation starts. Run `/speckit-analyze` before every `/speckit-implement`, even when asked to
just "continue", unless the user says it already ran or to skip it. Small fixes and one-commit
changes skip the pipeline.

Those commands gate against `.specify/memory/constitution.md`. It states principles;
[CONTRIBUTING.md](./CONTRIBUTING.md) holds the mechanics they compile down to, and this file the
runtime guidance for agents. Where they disagree, fix the operational file rather than working
around it.

Spec Kit is branch-agnostic: `create-new-feature.sh` invokes git nowhere, and its `NNN-slug` string
names the `specs/` directory rather than a branch. Keep using `type/short-slug` branches. Commit
each artifact as it lands (`docs: spec <feature>`, `docs: plan <feature>`,
`docs: break <feature> into tasks`), and fold later refinements into that commit with `--fixup` (see
CONTRIBUTING, "What to squash").

`.specify/` is vendored by the Specify CLI, which rewrites `scripts/` and `templates/*.md` on every
refresh. Customize through `.specify/templates/overrides/<name>.md` rather than editing them in
place.

Spec Kit gotchas:

* **A fresh clone cannot resume a committed feature.** `.specify/feature.json` is the only
  feature-context source the scripts accept, and Spec Kit gitignores it as machine-local state.
  Every speckit command fails with "Feature directory not found" until you
  `export SPECIFY_FEATURE_DIRECTORY=specs/<NNN-slug>` or re-run `/speckit-specify`. Set the env var
  when picking up a feature started elsewhere, including in another worktree.
* **dprint rewrites Spec Kit's checkboxes, so `specs/**/tasks.md`, `specs/**/checklists/`, and the
  tasks-template override are excluded.** `unorderedListKind: "asterisks"` turns `- [ ]` into
  `* [ ]`, and `/speckit-implement` and `/speckit-converge` read task state from the hyphen form.
  The rewrite is silent and still renders fine, so the damage only shows when a speckit command
  finds no tasks. Prose artifacts in `specs/` carry no checkboxes and stay linted.
* **Vendored Spec Kit files are exempt from dprint and typos, narrowly.** `dprint` skips
  `.specify/templates/*.md` and `.claude/skills/speckit-*/`; `typos` skips `.specify/scripts/`,
  `.specify/templates/*.md`, and `.claude/skills/speckit-*`. The Specify CLI rewrites all of them on
  refresh, so any fix would be undone. `.specify/memory/constitution.md` and
  `.specify/templates/overrides/` are project-authored and stay linted, apart from dprint skipping
  the tasks-template override above. Don't widen either exclusion to `.specify/**`. `typos.toml`
  sets `ignore-hidden = false`, because typos otherwise skips dot-directories such as `.specify/`,
  `.claude/`, and `.github/` entirely.

## Code style

* Slight preference for writing tests before features.
* Write prose (docs, comments, commit messages) in Canadian spelling: colour, centre, -ize
  (organize, memorize), labelled. Identifiers and wire names keep their spelling.
* Comments are part of the code: update them when the surrounding code changes, since stale comments
  are bugs. Use correct grammar and spelling.
* Comments explain **why**, sometimes **how at a high level**, never **how at a low level** (don't
  restate what well-named code already says). Prefer line comments on the previous line over block
  or trailing comments. Docstrings stay brief and focus on what isn't obvious from the signature.
  Don't be too picky about removing existing comments.

<!-- END shared agent workflow -->

## Key Conventions

* Scoring functions are **pure** — `cells[teamIdx][seatIdx][colIdx]` in, result out. No Vue. They
  live in `packages/shared/src/scoring/`, so the scoresheet, portal and API score the same way.
* Column keys depend on the quiz format. 20-question: `"1"`–`"15"`, `"16"`/`"16A"`/`"16B"` through
  `"20B"`, `"21"`+ for overtime. 15-question: `"1"`–`"11"`, `"12"`/`"12A"`/`"12B"` through `"15B"`,
  `"16"`+ for overtime.
* Tests live in `__tests__/` subdirectories next to the code they test.

## Gotchas

* `createQuizStore()` is a factory — no singleton. Call it fresh per test.
* `buildColumns(rules, n)` takes the format's `QuizRules` and an overtime round count; `n=0` means
  no OT columns at all. Scoring functions take `rules` as a required parameter; don't default it.
* `isErrorPoints` starts at the format's first error-points question (Q17, or Q13 in a 15-question
  quiz) and covers all OT columns, but **not** the first A/B question (Q16, or Q12).
* Foul deduction does not stack: 3rd-team-foul + foul-out on the same foul = only −10.
* Drag reorder uses pointer events only (no HTML5 drag API — crashes on Linux/X11).
* **Vue 3 template compiler bug:** multi-statement `@click` handlers without semicolons are rejected
  (vuejs/core#8854). Prettier removes semicolons on format, re-triggering the error. Always extract
  multi-statement handlers to named functions in `<script setup>` instead of inline expressions.
* Auth uses Better Auth cookie sessions — no JWTs for user auth. `BETTER_AUTH_SECRET` must be ≥32
  chars. OAuth callbacks: `/qzr/api/auth/callback/github`, `/qzr/api/auth/callback/google` (locally
  the dev API answers at the root, `/api/auth/...`). The base path is the mount that matched
  (`routePath` in `src/index.ts`), and cookies use the `qzr` prefix so they don't clash with
  verse-vault's on the same host.
* **A stale Vite watcher looks like a CSS bug.** Long-running dev servers (especially once Linux
  hits its inotify limit) silently stop picking up edits. If a visual change "didn't work" but the
  file on disk is right, fetch the served stylesheet (`curl` the `?vue&type=style` URL) and compare
  before editing again; if it's stale, ask the user to restart `pnpm dev:all`.
* **Never hand-write or edit migration files.** Always run `pnpm --filter @qzr/api db:generate` to
  generate migrations from the schema diff. If the generated SQL won't work (e.g. `ADD NOT NULL` on
  existing rows), fix the schema design instead — make the column nullable, provide a default, or
  split into two migrations. The `migrations/meta/_journal.json` must stay in sync.

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
