# Contributing

How changes get into qzr: hooks, git conventions, commit format, contract versioning, and releasing.
Setup and day-to-day commands are in the [README](./README.md). The principles these mechanics
implement are in the [constitution](./.specify/memory/constitution.md). Coding agents also read
[CLAUDE.md](./CLAUDE.md), which adds agent-specific guidance and points back here.

## Before you push

`pnpm test:unit`, `pnpm type-check`, `pnpm lint`, `pnpm exec dprint check`, and `typos` must pass;
CI runs them as the required `check` status, along with the deploy's contract check for any package
the PR bumps.

## Hooks

Hooks are wired via `simple-git-hooks` + `lint-staged` and installed by `pnpm install` (see the
`postinstall` script in `package.json`). The `pre-commit` hook runs `lint-staged` (Prettier on
TS/Vue/CSS, ESLint fixes, `dprint` on markdown / Dockerfiles), then `typos` (the bare binary, which
must be on `PATH`: `cargo install typos-cli` or your distro's package), then
`tools/check-contract-versions.sh` (see [Contract package versioning](#contract-package-versioning)
and [Releasing](#releasing)). The `commit-msg` hook runs `commitlint` against the
conventional-commits config (see `commitlint.config.js` for the scope-enum and length rules below).

## Git conventions

<!-- BEGIN shared git conventions: keep identical in qzr-sheet and verse-vault -->

### Branches

Work on feature branches; never commit directly to master. Branch names use a `type/short-slug`
shape matching the commit type, e.g. `feat/schedule-editor`, `fix/empty-passage-blocks`,
`docs/roadmap-anki-import`.

A sub-feature that will take more than one commit gets its own branch off the feature branch
(`feat/schedule-editor` → `feat/roll-teams`), merged back with `git merge --no-ff`. Single-commit
tweaks stay on the parent branch.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short subject in lowercase>

<wrapped body explaining why, not what (the diff shows what)>
```

**Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `style`, `revert`, `perf`,
`build`.

**Scope:** one of the repo's scopes listed under [Commit scopes](#commit-scopes), or omitted for a
cross-cutting change. Use bare `docs:` for doc-only edits; sub-scoping by doc area (`docs(arch)`,
`docs(server-api)`) sprawls fast and isn't enforced.

**Subject:** lowercase, imperative mood, no trailing period, and **≤ 50 characters** including the
`type(scope):` prefix. `commitlint` enforces the length as an error. Apply the "if applied, this
commit will \_\_" test: `simplify cleanup pass` and `heading split + passage card render` both fail
it, because they name the change as a noun rather than the action it performs.

**Breaking changes** carry `!` after the type or scope (`feat(api)!: …`): a wire format, file
format, or public-type change consumers must adapt to.

**Body:** wrapped at ~72 columns (a warning, not an error: quoted URLs and stack traces are fair
exceptions), and focused on _why_.

### Commits are atomic

One logical change per commit, and each commit should build on its own. Commit as you go: once a
chunk compiles and its tests pass, commit it rather than batching everything at the end. The target
is that `git blame` on any line lands on a commit whose message explains that line.

### Pull requests

PRs are feature-sized and carry several logical commits: many atomic commits, few PRs. A substantive
change shouldn't arrive as a single commit, and a one-line change usually doesn't need its own PR.
Fold follow-ups that touch the same surface into the in-flight branch, and land design docs with the
code they describe. Split only for different urgency or a genuine precondition.

### Merging

* **Always merge, never squash:** `gh pr merge <N> --merge --delete-branch`. The individual branch
  commits must land on master so `git log` shows the real progression. Squash and rebase merges are
  disabled in the GitHub settings.
* **Merge-commit subjects follow Conventional Commits too**, typically `chore: merge <branch-name>`.
  GitHub's default `Merge pull request #N from …` template doesn't conform, so pass
  `--subject "chore: merge <branch>"` to `gh pr merge`, or `git merge --no-ff -m "..."` for a local
  merge.
* **master is branch-protected.** GitHub blocks the merge until the
  [required checks](#required-checks) pass on the PR. It doesn't require the branch to be up to
  date, so a PR merged while behind master lands a combination CI never ran; the rebase default
  below is what closes that gap. The owner can bypass the checks with
  `gh pr merge <N> --admin --merge ...` for a true hotfix: a conscious decision, not a default.
* **Rebase onto current master before merging.** Testing the branch against the master it will land
  on lowers the chance of a bad interaction slipping through, so update the PR first
  (`git rebase master` and `git push --force-with-lease`, or GitHub's "Update branch" with rebase).
  It's a strong default, not a requirement, and GitHub doesn't enforce it. The exception is a PR
  that bumps a deployable package's version, which must be rebased: PR CI runs the deploy-time
  `tools/check-contract-versions.sh --ci` check against the PR merged into master as of the run, so
  only a fresh run checks the bump against the master it will deploy from.
* **Clean up locally.** GitHub deletes the remote branch on merge. Afterwards,
  `git checkout master`, `git pull --ff-only`, and `git branch -d <branch>` so stale local branches
  don't pile up.

### Rewriting history

**Feature branches:** rewriting is encouraged. Rebase, amend, reorder, and squash fixups
(`git push --force-with-lease`) whenever it produces a cleaner series _before_ merging.

**Master:** never. Once a commit is on master it stays.

**What to squash:** "changed my mind from X to Y" iterations whose intermediate state never ships.
Keep the small atomic commits that each did real incremental work. Documents follow the same rule:
refining a spec, plan, or design doc before anything is built on it folds into the commit that added
it. A change of mind worth remembering, such as a decision reversed once planning or implementation
proved it wrong, is real history: give it its own commit, with the reason in the body.

**Fixup + autosquash.** When a later commit corrects something an earlier commit on the same branch
got wrong (a typo, a missed branch, a review reply), prefer `git commit --fixup=<orig-sha>` over a
fresh `fix(...)` commit. Collapse before merging:

```
git -c sequence.editor=: rebase -i --autosquash master
```

`-i` is required (autosquash only activates in interactive mode); the no-op sequence editor accepts
the auto-prepared todo list, and `fixup!` commits discard their own message, so no editor opens. The
result is that `git blame` lands on the original commit, whose message explains the change, rather
than a follow-up that restates the same scope.

Two caveats. On a long-lived branch with interleaved refactors touching the same lines, autosquash
will conflict; keep the plain `fix(...)` commit instead. And check whether the fixup changes what
the target's subject claims: a typo fix slots in invisibly, but a fixup that expands scope or
reverses a stated intent leaves the subject lying about the squashed commit. In that case use
`git commit --fixup=amend:<orig-sha>`, which prompts for a new subject when collapsing, or
`git commit --amend` if the target is HEAD.

<!-- END shared git conventions -->

### Commit scopes

`scoresheet`, `web`, `api`, `shared`, `ui`, `tauri`, `ci`, `deps`. `commitlint` warns on any other
scope; if a new one makes sense, add it to `commitlint.config.js`. A release commit names its
package: `chore(<pkg>): release X.Y.Z` (see [Releasing](#releasing)).

### Required checks

One job, `check`: `pnpm type-check`, `pnpm lint`, `pnpm test:unit`, `dprint check`, `typos`, the
`@qzr/shared` bump check (`tools/check-contract-versions.sh --pr`), and the deploy's contract check
for every package the PR bumps. The version files that make a PR a bump PR are
`apps/scoresheet/package.json`, `apps/web/package.json`, and `packages/api/package.json`.

## Contract package versioning

`packages/shared` (QuizFile schema, role enums, shared API types) is a contract across consumers —
the API today, the scoresheet PWA + Tauri client, and the web portal. Its `package.json` version is
the contract version: same `@qzr/shared@X.Y.Z` across consumers means same observable wire/state
behaviour. Semver semantics:

* **MAJOR** — breaking change to wire format, file format (`FILE_VERSION` bump in
  `packages/shared/src/quizFile.ts`), or shared types consumers must adapt to.
* **MINOR** — additive (new optional field, new enum value consumers can ignore).
* **PATCH** — an observable fix that leaves the contract's shape unchanged.

A refactor with no observable effect doesn't bump at all: commit it with `--no-verify` instead.

Enforcement:

* **Pre-commit** (`tools/check-contract-versions.sh`): blocks a commit that touches
  `packages/shared/src/` while `packages/shared/package.json` still has the version the branch
  started from (the more recent fork point of `master` and `origin/master`). Bump once per PR, in
  the first commit that changes shared (or an earlier one); later shared commits extend that dated
  `CHANGELOG.md` section rather than bumping again.
* **PR CI** (`--pr <base>`, run by the required `check` job): the same check against the PR's base,
  which also catches commits that skipped the hook (`--no-verify`, or history rewritten by a rebase
  or cherry-pick, which don't run pre-commit).
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
is bumped once in the PR that changes it (see above), and the first consumer deploy that bundles the
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

For `scoresheet`, `web`, or `api`, use the `/release <pkg>` skill (see
`.claude/skills/release/SKILL.md`) on the PR's branch, or do it manually:

```sh
# 1. Promote the package's [Unreleased] entries to a dated section:
#       ## [<new>] - YYYY-MM-DD
#       ### Added / Changed / Fixed
#       …
#    Also add a:
#       ### Bundled contract
#       * @qzr/shared@<current> — unchanged | bumped from <old>

# 2. Bump the package version (only that package's files move):
pnpm bump <scoresheet|web|api> <semver>

# 3. Commit on the PR's branch, with the change or as its own commit:
git add <reported-files> <package>/CHANGELOG.md
git commit -m "chore(<pkg>): release <semver>"
```

Merging the PR to master fires the matching `.github/workflows/deploy-<pkg>.yml` (or
`release-scoresheet.yml`), runs the contract check, deploys, and tags `<pkg>@<semver>` on success.
**Don't tag locally** — CI does it.
