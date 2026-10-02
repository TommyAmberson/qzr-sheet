# Research: 15-question quiz format

Phase 0 output for [plan.md](./plan.md). Technical Context carried no NEEDS CLARIFICATION; this
records the design decisions the plan rests on and what was weighed for each.

## R1. How a quiz knows its format

* **Decision**: a `QuizFormat` enum in `packages/shared/src/quizFile.ts`, with values
  `TwentyQuestion = '20-question'` and `FifteenQuestion = '15-question'`, stored on the quiz as
  `format`.
* **Rationale**: matches the existing per-quiz variants (`PlacementFormula`, `BonusRule`), which are
  shared enums on the quiz. The string values are self-describing in a saved file. The two-team
  rulebook tie-breaker can join later as a third value without renaming these.
* **Alternatives considered**: a numeric `questionCount: 15 | 20` field reads naturally but cannot
  tell a three-team 15-question quiz from the future two-team tie-breaker, which has the same count
  and different rules.

## R2. File version and contract level

* **Decision**: a file's `version` is the **version needed to read it**: the lowest file version
  that can express its contents. `FILE_VERSION` becomes 3, the newest version this build reads and
  writes. A 20-question quiz saves exactly as today: version 2, no `format` field. A 15-question
  quiz saves as version 3 with `quiz.format`. On load, version 1 and 2 files are 20-question and
  fail if they name a format; a version 3 file without `format` fails validation. Files claiming a
  version newer than 3 are detected before schema validation and handled as in R2a. `@qzr/shared`
  takes a MAJOR bump (0.10.0 to 1.0.0), because a reader of the old contract cannot read every file
  the new one writes. The commit is marked breaking and left unscoped, `feat!:`, since it also
  changes the scoresheet.
* **Rationale**: the scoresheet parses files with TypeBox `Value.Parse`, whose default pipeline
  includes `Clean`, which drops properties the schema does not declare. Probed in this session: an
  object with an undeclared `format` comes back without it. Older installs (desktop builds have no
  auto-updater, issue #5) therefore cannot be trusted with a `format` field they do not know:
  * They cannot score a 15-question quiz correctly at all, so the best outcome is refusal. Version 3
    gets that, because their schema accepts only versions 1 and 2.
  * They can score a 20-question quiz, and a 20-question file written as version 2 is byte-for-byte
    the format they already read, so they keep opening every 20-question file a newer install saves.
    Mixed-version meets keep working for the common case.
* **Alternatives considered**:
  * Optional field on version 2 with a MINOR bump: older installs open 15-question files as
    20-question quizzes and misscore them silently, violating principle I. Rejected.
  * Version 3 for every save: one rule, but older installs refuse every file a newer install saves,
    including 20-question quizzes they could score perfectly well. Rejected after the maintainer
    asked for a way around the refusal.
  * Encoding a 15-question quiz so that 20-question rules happen to score it right: impossible, as
    quiz-out at 3 and error points from 12 cannot be expressed in a 20-question layout.

## R2a. Attempting to open a newer file

* **Decision**: when a file's `version` is above `FILE_VERSION`, the scoresheet asks: "This file was
  saved by a newer version of the scoresheet. Update to open it reliably. Try to open it anyway?
  Scores may be wrong." On yes, it parses the file with the version check skipped. Fields this build
  does not know are dropped, as `Value.Parse` already does, and the quiz opens with a persistent
  warning badge ("Opened from a newer file; may be scored wrong") until another quiz replaces it: a
  new quiz, or any file opened normally; it survives reloads and the tutorial (FR-017). Values the
  build cannot interpret, such as an unknown `format`, still fail with a message naming them:
  guessing a format would score by the wrong rules. On no, nothing changes.
* **Rationale**: the maintainer asked for a way to attempt opening newer files. Refusing outright
  protects scores but strands an official whose install is behind. A consented, clearly flagged
  best-effort open keeps principle I's "never silently" while letting them proceed.
* **Limit**: installs shipped before this feature cannot do this; their code is fixed and refuses
  version 3. The prompt helps from this release onward, for the next file version.
* **Newer auto-save** (analysis finding C1): today an unreadable auto-save is deleted on startup
  (`persistence/autoSave.ts`), which for a newer auto-save would silently discard a quiz, against
  principle I. A newer auto-save is instead moved to its own `qzr-sheet:newer-autosave:<timestamp>`
  key, the sheet starts empty, and a notice offers "Try to open it" or "Discard"
  ([contracts/quiz-file.md](./contracts/quiz-file.md)). Other unreadable auto-saves keep today's
  handling.
* **Alternatives considered**: read-only best-effort view. Safer, but an official at a meet usually
  needs to keep scoring, and the badge already warns. Not chosen.

## R3. Where the format's numbers live

* **Decision**: a new pure module `apps/scoresheet/src/scoring/quizRules.ts` exports a `QuizRules`
  type and `quizRules(format)`. `QuizRules` holds `regulationQuestions`, `firstAbQuestion`,
  `firstErrorPointsQuestion`, `quizOutCorrect`, and `overtimeRoundSize` (3 in both formats). Helpers
  derive the rest: the first overtime question is `regulationQuestions + 1`, and the last question a
  timeout may follow is `firstErrorPointsQuestion - 1`. `MAX_TIMEOUTS_PER_TEAM` stays a constant (2
  in both formats, FR-015).
* **Rationale**: one table maps each format to its numbers, which is the spec's Context table turned
  into code, and every hard-coded 15/16/17/20/21/4 in scoring reads from it. Living in `scoring/`
  keeps it under principle III.
* **Alternatives considered**: deriving every boundary from the `Column[]` array (first overtime
  number = last regulation number + 1, and so on). Columns already carry `isAB`, `isErrorPoints`,
  and `isOvertime`, so structure would come for free, but the quiz-out threshold is not a column
  property and would still need passing, leaving two sources of truth.

## R4. How scoring functions receive the rules

* **Decision**: functions that need a number take `rules: QuizRules` as a required parameter:
  `buildColumns(rules, overtimeRounds)`, `scoreTeam`, `validateCells`, and the overtime and
  column-visibility functions that hard-code 20 or 21 today, plus every overtime function that calls
  `scoreTeam` (including `computeRegulationScores`), since quiz-out changes totals. Column structure
  (`isAB`, `isErrorPoints`, `isOvertime`) stays on the columns, so `greyedOut` and `placement` need
  no change.
* **Rationale**: required parameters make the type checker list every call site. A default of
  20-question rules would let a forgotten call site score a 15-question quiz by 20-question rules,
  silently.
* **Alternatives considered**: an optional parameter defaulting to 20-question rules. It keeps
  existing tests untouched, but it is exactly the silent fallback above. Existing tests instead get
  a shared `TWENTY` fixture, a mechanical edit.

## R5. Starting a quiz in a given format

* **Decision**: `resetStore(format = TwentyQuestion)` in `useScoresheet`. The New menu replaces "New
  quiz" with "New 20-question quiz" and "New 15-question quiz". The Ctrl+N shortcut, which calls
  `newQuiz()` from `App.vue`, starts a new quiz in the **current** quiz's format.
* **Rationale**: practice meets run many 15-question quizzes in a row, so repeating the current
  format from the shortcut avoids switching back to 20 each time. The menu always offers both
  explicitly. Format still cannot change on a quiz in progress (FR-001).
* **Alternatives considered**: Ctrl+N always starts a 20-question quiz. Predictable, but at a
  practice meet a stray Ctrl+N produces the wrong sheet every time.

## R6. Keeping the format through store operations

* **Decision**: `quizStore.loadState` copies `state.quiz.format`. `clearAnswers` already passes
  `store.quiz` through `loadState`, and `clearNames` and meet or schedule loading only rename teams
  and quizzers, so all preserve the format once `loadState` copies it. Auto-save and file save go
  through `serialize`, which writes it.
* **Rationale**: `loadState` copies quiz fields one by one, and it currently omits `bonusRule`
  (pre-existing: a loaded file's bonus rule is ignored). The format would hit the same trap, so the
  copy is its own task with its own test (`loadState` keeps `format`). The file save/open round trip
  is tested separately.
* **Note**: the `bonusRule` omission is outside this feature and tracked as #78 (CLAUDE.md, scope
  discipline). A test that every quiz field survives `loadState` belongs there: it would fail today
  on `bonusRule`.

## R7. Tutorial

* **Decision**: the tutorial still teaches on a 20-question sheet. It snapshots the current quiz
  through `serialize`/`parseQuizFile`, calls `resetStore()` (default 20-question), and restores the
  snapshot afterwards, so a 15-question quiz comes back as one. It carries the newer-file warning
  across that reset, and its crash recovery treats a snapshot from a newer version like a newer
  auto-save (contracts/quiz-file.md).
* **Rationale**: the tutorial steps hard-code 20-question column indices; teaching on a 20-question
  sheet keeps them valid.

## R8. Spreadsheet (ODS) export and import

* **Decision**: the "Export ODS" menu item is disabled for 15-question quizzes, with a tooltip
  saying spreadsheet export supports 20-question quizzes only. `fillOts` itself refuses any other
  format, with the same message, so the limit lives in the export layer. `readOds` and `fillOts`
  keep 20-question rules explicitly (`TWENTY_QUESTION_RULES`); `readOds` stamps the `QuizFile` it
  builds with `fileVersionFor(TwentyQuestion)`, version 2, and sets no `format`, like any
  20-question file (contracts/quiz-file.md).
* **Rationale**: the template's formulas score 20 questions; a 15-question export would be wrong.

## R9. Timeout rule and message

* **Decision**: `isTimeoutAllowed(columnKey)` compares against `lastTimeoutQuestion(rules)`. The
  validation code `TimeoutAfterQ16` is renamed `TimeoutAfterErrorPoints`, and its message becomes
  "Timeouts can't be called once error points begin", which is true in both formats. The duplicate
  literal in `Scoresheet.vue` reads the shared message instead.
* **Rationale**: the clarified rule is "no timeouts after error points are announced"; the message
  should state the rule, not a format-specific number.

## R10. Showing the format

* **Decision**: a read-only badge in the header's right-hand meta area, beside the Overtime toggle,
  reading "20 Q" or "15 Q", always shown (FR-011).
* **Rationale**: officials switch between formats at practice meets; always showing it removes the
  doubt about which sheet is open.

## R11. Placement

* **Decision**: no change to `placement.ts`. Regulation scores come from `computeRegulationScores`,
  which already filters on `!isOvertime`, so a 15-question quiz's placements use the end-of-Q15
  score with the selected formula (FR-008). Only its doc comment ("Q1-20") is corrected.

## R12. Documentation

* **Decision**:
  * `docs/scoring-rules-explained.md`: the 15-question layout and point rules, and a new section
    "Rules not in the rulebook" listing each 15-question rule with its basis (FR-014).
  * `docs/architecture.md`: `quizRules.ts`, `QuizFormat`, and `FILE_VERSION` 3.
  * `CLAUDE.md`: column keys per format, and the gotchas that name Q16/Q17 and the `buildColumns`
    signature. `CONTRIBUTING.md`: the `FILE_VERSION` location (it lives in `packages/shared`).
  * `apps/web/src/views/RoadmapView.vue`: the 15-question quiz under "Available now".
  * Changelogs: `packages/shared` (1.0.0, breaking), `apps/scoresheet` (minor bump to 0.12.0), and
    `apps/web` (patch bump to 0.12.2 for the roadmap entry), each consumer with
    `### Bundled contract` naming `@qzr/shared@1.0.0`.
