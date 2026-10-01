# Contributing

How changes get into qzr: hooks, git conventions, commit format, contract versioning, and releasing.
Setup and day-to-day commands are in the [README](./README.md). The principles these mechanics
implement are in the [constitution](./.specify/memory/constitution.md). Coding agents also read
[CLAUDE.md](./CLAUDE.md), which adds agent-specific guidance and points back here.

## Before you push

`pnpm test:unit`, `pnpm type-check`, and `pnpm lint` must pass; CI runs them as the required `check`
status, along with the deploy's contract check for any package the PR bumps.

## Hooks

Hooks are wired via `simple-git-hooks` + `lint-staged` and installed by `pnpm install` (see the
`postinstall` script in `package.json`). The `pre-commit` hook runs `lint-staged` (Prettier on
TS/Vue/CSS, ESLint fixes, `dprint` on markdown / Dockerfiles), then
`tools/check-contract-versions.sh` (see [Contract package versioning](#contract-package-versioning)
and [Releasing](#releasing)). The `commit-msg` hook runs `commitlint` against the
conventional-commits config (see `commitlint.config.js` for the scope-enum and length rules below).

## Git conventions

* Commits must be atomic and single-responsibility — one logical change per commit.
* Commit as you go: after each logical chunk compiles and tests pass, commit it — don't batch at the
  end.
* Work on feature branches, not directly on master.
* A sub-feature that will take more than one commit gets its own branch off the feature branch
  (`feat/schedule-editor` → `feat/roll-teams`), merged back with `git merge --no-ff`. Single-commit
  tweaks stay on the parent branch.
* Pull requests are feature-sized: many atomic commits, few PRs. Fold follow-ups that touch the same
  surface into the in-flight branch, and land design docs with the code they describe. Split only
  for different urgency, different reviewers, or a genuine precondition.

### Merging PRs

* Always use a merge commit, never squash: `gh pr merge <N> --merge --delete-branch`. The individual
  branch commits must land on master so `git log` shows the actual progression.
* Merge-commit subjects follow conventional-commits, same as regular commits — typically
  `chore: merge <branch-name>`. For local merges, set this via `git merge --no-ff -m "..."`. For
  PRs, pass `--subject "chore: merge <branch>"` to `gh pr merge` (or edit before confirming) —
  GitHub's default `Merge pull request #N from …` template doesn't conform to commitlint.
* `--delete-branch` only removes the remote branch. After merging, `git checkout master`,
  `git pull --ff-only`, and `git branch -d <branch>` so stale local branches don't pile up.

### Rewriting history

* **Feature branches:** rewriting is fine and often encouraged (rebase, amend, reorder, squash
  fixups, `git push --force-with-lease`) when it produces a cleaner, more readable series _before_
  merging.
* **Master:** never rewrite history. Once a commit is on master, it stays.
* **What to squash:** "changed my mind from X to Y" iterations where the intermediate state never
  ships. Keep small atomic commits that each did meaningful incremental work — the goal is that
  `git blame` on any given line lands on a commit whose message explains the change.
* **Fixup + autosquash for review fixes.** When a later commit corrects something an earlier commit
  on the same branch got wrong (typo, missed branch, /simplify finding, code-review reply), consider
  `git commit --fixup=<orig-sha>` instead of a fresh `fix(...): ...` commit. That produces a commit
  named `fixup! <orig-subject>` paired with the target. Before merging, collapse with
  `git -c sequence.editor=: rebase -i --autosquash master` — `-i` is required (autosquash only
  activates in interactive mode) and the no-op sequence editor accepts the auto-prepared todo list.
  Fixup-marked commits discard their own message and keep the original's verbatim, so no editor
  prompts fire. End state: `git blame` lands on the original commit (whose message explains the
  change), not a follow-up "fix" commit that re-states the same scope. Works best when the target is
  recent and no intermediate commits touch the same lines — long-lived branches with interleaved
  refactors will produce conflicts on autosquash, in which case keep the fresh `fix(...)` commit.
  Before squashing, check whether the fixup's content changes what the target commit's subject
  claims: a typo or off-by-one fix slots in invisibly, but a fixup that meaningfully expands scope
  or reverses a stated intent leaves the original subject misleading. In that case, use
  `git commit --fixup=amend:<orig-sha>` instead — autosquash will prompt for a new subject when
  collapsing — or just `git commit --amend` directly if the target is HEAD. Otherwise the squashed
  commit will lie about what it does.

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
the API today, the scoresheet PWA + Tauri client, and the web portal. Its `package.json` version is
the contract version: same `@qzr/shared@X.Y.Z` across consumers means same observable wire/state
behaviour. Semver semantics:

* **MAJOR** — breaking change to wire format, file format (`FILE_VERSION` bump in
  `apps/scoresheet/src/persistence/quizFile.ts`), or shared types consumers must adapt to.
* **MINOR** — additive (new optional field, new enum value consumers can ignore).
* **PATCH** — an observable fix that leaves the contract's shape unchanged.

A refactor with no observable effect doesn't bump at all: commit it with `--no-verify` instead.

Enforcement:

* **Pre-commit** (`tools/check-contract-versions.sh`): blocks commits that touch
  `packages/shared/src/` without bumping `packages/shared/package.json` **in the same commit**. A
  separate follow-up bump commit doesn't satisfy it, so the bump, and its `CHANGELOG.md` entry, ride
  along with the change itself.
* **CI** (each deploy workflow runs `tools/check-contract-versions.sh --ci <consumer>`): blocks the
  consumer's deploy when its `CHANGELOG.md` entry for the version being deployed doesn't reference
  the current `@qzr/shared` version under a `### Bundled contract` subsection. Catches "bumped
  shared but forgot to update the api/web/scoresheet changelog."

When you bump `@qzr/shared`, the next bump of any consumer (`api`, `web`, `scoresheet`) must update
that consumer's `### Bundled contract` subsection to name the new shared version.

## Releasing

Per-package: `scoresheet`, `web`, and `api` each have their own `package.json` `version` field,
their own `CHANGELOG.md`, and their own CI deploy workflow that fires when the version bump lands on
master. `shared` has a version and changelog but no deploy workflow and no separate release step: it
is bumped in the commit that changes it (see above), and the first consumer deploy that bundles the
new version tags `shared@<version>`.

**Release with the change.** A pull request that changes `scoresheet`, `web`, or `api` records the
change in that package's `CHANGELOG.md` and, by default, bumps the package in the same PR, so
merging it is the release. Bump once per package per PR: the first commit that touches the package
bumps it and adds the dated section, and later commits on the branch extend that section rather than
bumping again. The pre-commit hook rejects a version bump without a staged dated section.

**Deferring a release.** To ship several PRs as one release, leave their entries under
`## [Unreleased]` and say so in each PR body. Keep the window short. While master holds unreleased
changes to a package, an urgent fix to that package can only ship by releasing them too. Before
deferring, check what is already waiting (`git log <pkg>@<last-version>..master -- <package-path>`),
and release the backlog with `/release <pkg>` on a `chore/release-<pkg>-<version>` branch.

**Rebase bump PRs.** A PR that bumps a version must be rebased onto current master before it merges,
so CI re-runs the deploy's contract check (`check-contract-versions.sh --ci`, run in PR CI for each
bumped package) against the master it will deploy from. Other PRs needn't be.

For `scoresheet`, `web`, or `api`, use the `/release <pkg>` skill (see
`.claude/skills/release/SKILL.md`) on the PR's branch, or do it manually:

```sh
# 1. Promote the package's [Unreleased] entries to a dated section:
#       ## [<new>] — YYYY-MM-DD
#       ### Added / Changed / Fixed
#       …
#    Also add a:
#       ### Bundled contract
#       * @qzr/shared@<current> — unchanged | bumped from <old>

# 2. Bump the package version (only that package's files move):
pnpm bump <scoresheet|web|api> <semver>

# 3. Commit on the PR's branch, with the change or as its own commit:
git add <reported-files> <package>/CHANGELOG.md
git commit -m "chore(<pkg>): bump to <semver>"
```

Merging the PR to master fires the matching `.github/workflows/deploy-<pkg>.yml` (or
`release-scoresheet.yml`), runs the contract check, deploys, and tags `<pkg>@<semver>` on success.
**Don't tag locally** — CI does it.
