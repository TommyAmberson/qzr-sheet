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

## [1.7.0] - 2026-11-04

### Added

* `schedule/`: the schedule builder's pure logic, starting with the rule book's prelim draw tables
  for 4 to 21 teams (`PRELIM_DRAW_PATTERNS`, `getPrelimDraw`), moved here from the portal so the
  builder, the API and the readers share them.
* The schedule document (`ScheduleDocumentSchema`, `SCHEDULE_FILE_VERSION` 1) and its file codec
  (`serializeSchedule`, `parseScheduleFile`, `NewerScheduleFileError`, `newScheduleDocument`):
  settings, frame rows, rooms, quizzes with their seats and pins, and the draw, in one versioned
  JSON document.
* The schedule conflict check (`checkSchedule`): every hard rule and warning of
  `docs/schedule-invariants.md` that a schedule breaks, by rule ID with the quizzes involved and a
  reason; and `resultName`, the name a schedule quiz's results are saved under (W-5).
* `drawPrelims`: a division's prelim quizzes as letters from either draw source, the rule book's
  tables for 4 to 21 teams or the rotating draw (no rematches from 7 teams up, any size to 90 and
  beyond), with 6 quizzes per team as two rounds that avoid repeating pairings.

## [1.6.0] - 2026-10-31

### Added

* The auth client gains the email-code plugin, with `requestPasswordReset` and `resetPassword` for
  "Forgot password?", and `sendVerificationCode` and `verifyEmail` for the address check after
  sign-up and in account settings (spec 005).
* `codeErrorMessage` turns a failed code request into a message for the person, never a raw error,
  and `providersDisconnectedBy` reads the GitHub and Google sign-ins a password reset disconnected.
* `connectedProviders`, `connectProvider` and `disconnectProvider` in the auth client, for account
  settings, and `socialSignInError` explains why connecting GitHub or Google failed.
* `pendingProvider`, `confirmProviderCode`, `resendProviderCode`, `claimProvider` and
  `takeOverAccount` in the auth client, for the code step and the "That's me" or "That's not me"
  choice after a GitHub or Google sign-in onto an unverified account, with the `PendingProviderStep`
  and `AccountError` types.
* `signInSocial` returns the result of a refused start (a rate limit, say) instead of nothing.
* `signUpCodeSkipped` reads a sign-up response whose verification code the daily limit skipped.
* `effectiveAccountRole`, an account's role as every check reads it: superuser only on a verified
  address, shared by the API and the portal.
* `SOCIAL_PROVIDERS`, `SOCIAL_PROVIDER_LABEL` and `isSocialProvider`, the one list of GitHub and
  Google with their labels, and `tooManyRequestsMessage` for an email limit's message.

### Changed

* `socialSignInError` explains `sign_in_with_provider`, an account that signs in only with GitHub or
  Google (opening the email form, where "Forgot password?" sets a password), and
  `provider_email_unverified`, a sign-in refused because the provider doesn't report its address
  verified, and its `account_not_linked` message points to connecting from account settings.

## [1.5.0] - 2026-10-04

### Added

* `divisionStandings` warns of look-alike team names (`lookAlike`): two names in the division within
  one edit of each other once folded for case and spaces, or two edits when both are at least six
  characters long. Names ending in different numbers or letters, such as "Calgary 1" and "Calgary
  2", or "Regina A" and "Regina B", are never flagged
* `editDistance`, the number of single-character edits between two strings, which the standings and
  the scoresheet's quizzer matching share
* `tidyName` is exported, so the API stores team names as the standings show them
* `DivisionTeamNames`, the shape of a meet's team names list on the wire

## [1.4.1] - 2026-10-03

### Fixed

* **15-question quizzes** - A/B questions begin at 12, not 11, and error points and 10-point bonuses
  at 13, not 12: a quizzer's first error on Q12 is free, a Q12 bonus is worth 20, and timeouts are
  allowed through Q12. A stored quiz with answers on 11A or 11B flags them as orphaned

## [1.4.0] - 2026-10-02

### Changed

* `serialize` takes what `deserialize` returns, quizzes without an `id` and teams without a
  `quizId`, which it never used, so a stored quiz file can be read, edited and written back.

## [1.3.0] - 2026-10-02

### Added

* `divisionStandings`, which ranks a division's teams by placement points over its counted quizzes,
  breaking ties by head-to-head, then total points, then fewest errors, and marks the finalists,
  with warnings for unequal quiz counts, quizzes that can't be placed, and a tie at the finalist
  cutoff.
* `foldName`, which folds a name for case and spaces, so the standings and the API's quiz names
  match names the same way.
* `quizName`, a quiz's name as officials know it ("D1 Q3", or "D1c Q3" in consolation), moved from
  the API so the portal names quizzes the same way.

## [1.2.0] - 2026-10-02

### Added

* `quizOutcome`, which scores and places a stored quiz from its file exactly as the scoresheet shows
  it: each team's score, place, placement points and error count, or that it can't be placed yet.
  With it, `overtimeRoundsNeeded` and `emptySeatKeys`, which the scoresheet now uses too.
* `isQuizFile`, which checks a value is exactly a quiz file without converting loose values, so the
  API stores only files that read back as they were checked.
* `ApiError.body`, the whole body of an error response, for errors that carry more than a message.
* `RESULT_ACTIONS`, how a revision of a stored quiz was saved, for the API's table and the portal.

## [1.1.0] - 2026-10-02

### Added

* The scoresheet's scoring, moved here unchanged so the portal and API can score stored quiz files:
  `scoreTeam`, grey-out, validation, overtime, placement and column visibility, the per-format
  `quizRules`, the scoresheet's column and quiz types (`buildColumns`, `Column`, `Quiz`, …), and the
  branded index types.
* Quiz file reading and writing, moved from the scoresheet: `serialize`, `deserialize`,
  `parseQuizFile`, `parseQuizFileAttempt`, `fileVersionFor` and `NewerFileVersionError`, so the API
  can validate submitted files the way the scoresheet does.
* `buildCellGrid`, which lays a quiz's answers out as the `cells[team][seat][col]` grid the scoring
  functions read, with `inSeatOrder`, `answerKey` and `answerLookup` for the order and lookup it
  uses.
* `assessQuiz`, which validates a quiz and places it once it can be placed, taken out of the
  scoresheet so a stored quiz is placed exactly as the sheet shows it, and `isTimeoutAllowed`.

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
