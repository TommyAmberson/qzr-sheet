# Changelog — @qzr/shared

All notable changes to the shared contract package (QuizFile schema, role enums, shared API types)
are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`@qzr/shared` is a **contract package** — its version is a compatibility signal across consumers
(scoresheet PWA + Tauri client, web portal, API Worker). Same version everywhere means same
observable wire/state behaviour. Discipline:

* **MAJOR** — breaking changes to wire format, file format (`FILE_VERSION` bump in `quizFile.ts`),
  or shared types that consumers must adapt to.
* **MINOR** — additive changes (new optional fields, new enum values consumers can ignore).
* **PATCH** — an observable fix that leaves the contract's shape unchanged.

A pull request that changes `packages/shared/src/` bumps `packages/shared/package.json` once, in the
first commit that touches shared, with a dated entry here that later commits on the branch extend.
`tools/check-contract-versions.sh` enforces this at pre-commit and in PR CI. A refactor with no
observable effect doesn't bump: commit it with `git commit --no-verify` instead.

When consumers bump their own version, they must update their CHANGELOG's `### Bundled contract`
subsection to name the current `@qzr/shared` version. CI verifies this in each deploy workflow.

## [Unreleased]

## [1.1.0] - 2026-10-02

### Added

* The scoresheet's scoring, moved here unchanged so the portal and API can score stored quiz files:
  `scoreTeam`, grey-out, validation, overtime, placement and column visibility, the per-format
  `quizRules`, the scoresheet's column and quiz types (`buildColumns`, `Column`, `Quiz`, …), and the
  branded index types.

## [1.0.0] - 2026-10-01

### Added

* `QuizFormat` enum (`'20-question'`, `'15-question'`) and an optional `quiz.format` field on
  `QuizFile`. A missing format means a 20-question quiz.

### Changed

* **Breaking:** `FILE_VERSION` is now 3 and the schema accepts versions 1, 2, and 3. A file is
  stamped with the version needed to read it: 20-question quizzes stay version 2, so readers of
  0.10.x and earlier keep opening them, while 15-question quizzes are version 3 and carry
  `quiz.format`. Readers of 0.10.x and earlier refuse version 3 files rather than opening them as
  20-question quizzes.

## [0.10.0] - 2026-10-01

### Added

* **`socialSignInError()` / `withoutErrorParam()`** - read and strip the `?error=` a failed GitHub
  or Google sign-in comes back with. `account_not_linked` (since better-auth 1.6.11, a social
  sign-in refuses to merge into an existing account whose email is unverified, which our password
  accounts always are) is reported as an existing account, so the UI can point the user at email
  sign-in

### Changed

* **`signInSocial` passes `errorCallbackURL`** - a failed social sign-in now returns to the page it
  started on, with `?error=`, instead of Better Auth's error page on the API

## [0.9.2] — 2026-05-21

First per-package release after the per-package deploys cutover. No source changes since v0.9.1
(unified tag) — bumping to establish the per-package baseline so consumer changelogs have a contract
version to reference under `### Bundled contract`. Future entries here document wire/state changes.
