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
* **PATCH** — pure documentation or refactor with no observable effect.

The pre-commit hook `tools/check-contract-versions.sh` blocks commits that touch
`packages/shared/src/` without a matching `version` bump in `packages/shared/package.json`. Bypass
with `git commit --no-verify` for refactors with no observable effect.

When consumers bump their own version, they must update their CHANGELOG's `### Bundled contract`
subsection to name the current `@qzr/shared` version. CI verifies this in each deploy workflow.

## [Unreleased]
