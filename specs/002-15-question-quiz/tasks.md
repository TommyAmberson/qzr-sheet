---

description: "Task list for the 15-question quiz format"
---

# Tasks: 15-question quiz format

**Input**: Design documents from `/specs/002-15-question-quiz/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/quiz-file.md,
quickstart.md

**Tests**: included. Constitution principle VI requires unit tests for scoring and validation
changes, and CLAUDE.md prefers writing them first. Within each phase, write the test task, see it
fail, then implement.

**Organization**: grouped by user story (spec.md) so each story is testable on its own.

**Paths**: monorepo. `scoresheet/` below means `apps/scoresheet/src/`; `shared/` means
`packages/shared/`. Run every pnpm command from the repository root.

**Commits**: commit after each task or tight group of tasks, Conventional Commits, subject at most
50 characters, scopes `scoresheet` / `shared` / `web` / none for docs and cross-package changes. See
CONTRIBUTING.md "Git conventions" and "Releasing".

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1 to US4)

---

## Phase 1: Setup

**Purpose**: confirm a green baseline in the feature worktree before changing anything.

- [X] T001 Run `pnpm install`, `pnpm test:unit`, `pnpm type-check`, and `pnpm lint` from the
  repository root; record any pre-existing failure before proceeding (none expected)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the rules table, the shared contract, and the quiz's `format` field. Every story
depends on these.

**⚠️ CRITICAL**: no user story work starts until this phase is complete.

### Rules table, no behaviour change (research R3, R4)

- [X] T002 Write `scoresheet/scoring/__tests__/quizRules.spec.ts`: `TWENTY_QUESTION_RULES` equals
  `{ regulationQuestions: 20, firstAbQuestion: 16, firstErrorPointsQuestion: 17, quizOutCorrect: 4,
  overtimeRoundSize: 3 }`; `firstOvertimeQuestion(rules)` is 21; `lastTimeoutQuestion(rules)` is
  16; invariant `firstAbQuestion < firstErrorPointsQuestion <= regulationQuestions`
- [X] T003 Create `scoresheet/scoring/quizRules.ts` exporting the `QuizRules` interface,
  `TWENTY_QUESTION_RULES`, `firstOvertimeQuestion(rules) = regulationQuestions + 1`, and
  `lastTimeoutQuestion(rules) = firstErrorPointsQuestion - 1`; pure, no Vue imports (principle III)
- [X] T004 Change `buildColumns(overtimeRounds)` to `buildColumns(rules: QuizRules,
  overtimeRounds = 0)` in `scoresheet/types/scoresheet.ts`: plain columns 1 to
  `firstAbQuestion - 1`; Normal/A/B for `firstAbQuestion` to `regulationQuestions` with
  `isErrorPoints = n >= firstErrorPointsQuestion`; overtime from `firstOvertimeQuestion(rules)` in
  rounds of `overtimeRoundSize`. Update the doc comments on `Column.isAB`, `isErrorPoints`,
  `isOvertime` to describe the rule, not Q16/Q17/Q21
- [X] T005 Add required `rules: QuizRules` to `scoreTeam` in `scoresheet/scoring/scoreTeam.ts` and
  replace the quiz-out literal `4` (lines ~121, ~128, ~212) with `rules.quizOutCorrect`; fix the
  "Before Q17" comment to "before error points"
- [X] T006 Add required `rules: QuizRules` to `validateCells` in `scoresheet/scoring/validation.ts`
  and replace `>= 4` (line ~164) with `rules.quizOutCorrect`. Rename `ValidationCode.TimeoutAfterQ16`
  to `TimeoutAfterErrorPoints` (value `'timeout-after-error-points'`), keeping its message text
  unchanged for now (it changes in US1, T030); update every reference
  (`scoresheet/composables/useScoresheet.ts` ~325 and ~351, `scoresheet/components/Scoresheet.vue`
  ~404) and make `Scoresheet.vue` ~1132 use `validationMessage(...)` instead of its own literal
- [X] T007 Add required `rules: QuizRules` to `getOvertimeEligibleTeams`, `getActiveOtTeams`,
  `computeOtIneligibility`, `quizJumpedComplete`, `computeOvertimeRounds`,
  `computeOtCheckpointScores`, and `computeRegulationScores` (all but `questionsComplete` call
  `scoreTeam`, which now needs the rules) in
  `scoresheet/scoring/overtime.ts`; replace `21 + r * 3` with
  `firstOvertimeQuestion(rules) + r * rules.overtimeRoundSize`, `20 + visibleOtRounds * 3` with
  `rules.regulationQuestions + visibleOtRounds * rules.overtimeRoundSize`, and
  `questionsComplete(..., 1, 20)` with `rules.regulationQuestions`
- [X] T008 Add required `rules: QuizRules` to `computeOrphanedColumns` and `computeVisibleColumns`
  in `scoresheet/scoring/columnVisibility.ts`; replace `20 + visibleOtRounds * 3` (lines ~53, ~113)
  as in T007
- [X] T009 Correct the "Q1–20" doc comment in `scoresheet/scoring/placement.ts` (~line 12) to
  "regulation columns"; no logic change
- [X] T010 In `scoresheet/composables/useScoresheet.ts`, add a `rules` computed (for now always
  `TWENTY_QUESTION_RULES`) and pass it to every function changed in T004 to T008; replace
  `buildColumns(20)` (~74), the `questionsComplete(..., 1, 20)` in `regulationComplete` (~461), and
  `num <= 16` in `isTimeoutAllowed` (~578) with `lastTimeoutQuestion(rules)`
- [X] T011 In `scoresheet/components/Scoresheet.vue`, derive the round-boundary list (~433:
  `[20]`, `23 + r * 3`), the regulation-end check (~488), the OT round-end check (~489), and the OT
  start classes (~796, ~798) from the `rules` exposed by `useScoresheet` instead of 20/21/23
- [X] T012 Pass `TWENTY_QUESTION_RULES` explicitly in `scoresheet/export/fillOts.ts` (~35) and
  `scoresheet/persistence/quizFile.ts` (~76) wherever `buildColumns` is called
- [X] T013 Update every existing spec that calls the changed functions to pass
  `TWENTY_QUESTION_RULES` (import as `TWENTY`): `scoring/__tests__/{greyedOut,validation,
  columnVisibility,scoreTeam,overtime}.spec.ts`, `composables/__tests__/{useCellSelector,
  useKeyboardNav}.spec.ts`, `stores/__tests__/{quizStore,moveQuizzer}.spec.ts`. Mechanical only:
  no assertion changes. Then run `pnpm test:unit`, `pnpm type-check`, `pnpm lint`: all pass
- [X] T014 Commit T002 to T013 as `refactor(scoresheet): derive quiz shape from rules`
  (no `packages/shared/src/` touched, so no version bump)

### Shared contract (research R1, R2; contracts/quiz-file.md)

- [X] T015 In `shared/src/quizFile.ts`: add `export enum QuizFormat { TwentyQuestion =
  '20-question', FifteenQuestion = '15-question' }`; add `format:
  Type.Optional(Type.Enum(QuizFormat))` to the `quiz` object; widen `version` to
  `Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)])`; set `FILE_VERSION = 3`
- [X] T016 In `scoresheet/persistence/quizFile.ts`, add exported `fileVersionFor(format:
  QuizFormat): 2 | 3` returning 2 for `TwentyQuestion` and 3 otherwise
  (contracts/quiz-file.md, "version needed to read"). Make `serialize` and
  `scoresheet/export/readOds.ts` (~237) stamp `version: fileVersionFor(QuizFormat.TwentyQuestion)`
  instead of `FILE_VERSION`, so no commit on this branch writes a 20-question file as version 3.
  Add a `quizFile.spec.ts` case: a serialized default quiz has `version: 2` and no `quiz.format`
- [X] T017 Bump `shared/package.json` 0.10.0 to 1.0.0 and add a dated `## [1.0.0]` section to
  `shared/CHANGELOG.md` (breaking: `QuizFile` version 3, `QuizFormat`, version-needed-to-read
  rule). Commit T015, T016, and T017 together as `feat!: add quiz format and file version 3` (no scope:
  it spans `shared` and `scoresheet`);
  the pre-commit contract check requires the shared bump, once per PR, by the first commit that
  changes `packages/shared/src/` (principle V)

### Quiz format on the quiz (data-model.md "Quiz")

- [X] T018 Write a failing test in `scoresheet/stores/__tests__/quizStore.spec.ts`: `loadState`
  with `format: QuizFormat.FifteenQuestion` leaves `store.quiz.format` at FifteenQuestion; a fresh
  store's format is TwentyQuestion
- [X] T019 Add `format: QuizFormat` to `Quiz` in `scoresheet/types/scoresheet.ts` ("Set when the
  quiz is created; never changed afterwards. Default 20-question"); default it in
  `createDefaultQuiz` and copy `state.quiz.format` in `loadState` in
  `scoresheet/stores/quizStore.ts`. Do **not** fix the missing `bonusRule` copy here (#78)
- [X] T020 Create `quizRules(format: QuizFormat): QuizRules` in `scoresheet/scoring/quizRules.ts`
  as an exhaustive `switch` so a future enum value fails type-check: the TwentyQuestion case
  returns `TWENTY_QUESTION_RULES`, and the FifteenQuestion case throws
  `new Error('15-question rules are not implemented yet')` until T028 replaces it. Then
  make the `rules` computed in `scoresheet/composables/useScoresheet.ts` read
  `quizRules(quiz.value.format)`

**Checkpoint**: every existing test passes, the sheet behaves exactly as before, and the quiz
carries a format.

---

## Phase 3: User Story 1 - Score a three-team 15-question quiz (Priority: P1) 🎯 MVP

**Goal**: an official starts a 15-question quiz and scores it under the 15-question rules.

**Independent Test**: start a 15-question quiz, enter a sequence covering a quiz-out, a bonus on
Q11 and on Q12+, and an error on Q12+, and match every total against a hand-scored sheet.

### Tests for User Story 1 (write first, see them fail)

- [X] T021 [P] [US1] Extend `scoresheet/scoring/__tests__/quizRules.spec.ts`:
  `quizRules(FifteenQuestion)` is `{ regulationQuestions: 15, firstAbQuestion: 11,
  firstErrorPointsQuestion: 12, quizOutCorrect: 3, overtimeRoundSize: 3 }`, first overtime 16,
  last timeout question 11, invariant holds for every `QuizFormat` value
- [X] T022 [P] [US1] Create `scoresheet/types/__tests__/buildColumns.spec.ts`: for 15-question
  rules, keys are `1`..`10`, then `11`,`11A`,`11B` .. `15B` (no `16`..`20` without overtime);
  `isAB` true from 11; `isErrorPoints` false on 11/11A/11B and true from 12; one overtime round
  yields `16`,`16A`,`16B`..`18B` with `isOvertime`. Also assert 20-question keys are unchanged
- [X] T023 [P] [US1] Add 15-question cases to `scoresheet/scoring/__tests__/scoreTeam.spec.ts`:
  quiz-out after 3 correct, with the +10 quiz-out bonus only when errors are 0; bonus `b` on Q11
  worth +20 and on Q12 worth +10; a first individual error (team's first) on Q11 costs 0 and on
  Q12 costs 10; unique-quizzer bonuses and on-time bonus unchanged
- [X] T024 [P] [US1] Add 15-question cases to `scoresheet/scoring/__tests__/validation.spec.ts`:
  a 4th correct after 3 is `QuizzerOut`; and to
  `scoresheet/scoring/__tests__/greyedOut.spec.ts`: an error on Q12 opens 12A as a toss-up for
  the other two teams and 12B as the bonus, mirroring the existing Q17 cases
- [X] T025 [P] [US1] Add to `scoresheet/composables/__tests__/useScoresheet.spec.ts`:
  `resetStore(QuizFormat.FifteenQuestion)` yields a 15-question quiz with 15-question columns;
  timeouts after `11`, `11A`, and `11B` are allowed and after `12` or later are refused; a team's
  third timeout is refused (2 per team, FR-015); `resetStore()` yields 20-question
- [X] T026 [P] [US1] Add to `scoresheet/scoring/__tests__/placement.spec.ts` (FR-008): for a
  15-question quiz with one overtime round, `computeRegulationScores` counts only Q1 to 15B and
  `computePlacements`/`computePlacementPoints` use those end-of-Q15 scores with the quiz's formula
- [X] T027 [P] [US1] Create `scoresheet/scoring/__tests__/fifteenQuestionQuiz.spec.ts` (SC-002): one
  complete three-team 15-question quiz, hand-scored in a comment table, covering a quiz-out with its
  bonus, a Q11 bonus (+20), a 12A/12B chain (+10), a first error on Q12 (-10), a foul, and the
  unique-quizzer bonuses; assert every team total, quizzer total, out, and placement

### Implementation for User Story 1

- [X] T028 [US1] Replace the FifteenQuestion `throw` in `quizRules` in
  `scoresheet/scoring/quizRules.ts` with its row; T021 to T024, T026, and T027 should now pass with no
  further scoring change (if one fails, a literal was missed in Phase 2: fix it in the scoring
  module, not in the test)
- [X] T029 [US1] Change `resetStore()` to `resetStore(format = QuizFormat.TwentyQuestion)` in
  `scoresheet/composables/useScoresheet.ts`, setting the fresh quiz's format before `loadState`
- [X] T030 [US1] Change the `TimeoutAfterErrorPoints` message in
  `scoresheet/scoring/validation.ts` to "Timeouts can't be called once error points begin" (true
  in both formats; research R9); `Scoresheet.vue` already reads it through `validationMessage`
- [X] T031 [US1] In `scoresheet/components/Scoresheet.vue`: `newQuiz(format)` passes the format to
  `resetStore`; the New menu replaces "✦ New quiz" with "✦ New 20-question quiz" and "✦ New
  15-question quiz", each calling its own named handler (no multi-statement inline `@click`,
  see CLAUDE.md Vue gotcha)
- [X] T032 [US1] Add the read-only format badge ("20 Q" / "15 Q", always shown, FR-011) to the
  `quiz-meta--right` area of `scoresheet/components/Scoresheet.vue`, before the Overtime toggle,
  styled with the existing meta tokens
- [X] T033 [US1] Run `pnpm test:unit`, `pnpm type-check`, `pnpm lint`; then quickstart.md steps 1
  to 5 in `pnpm dev`. This is the branch's first observable scoresheet change, so it releases the
  package (CONTRIBUTING.md "Release with the change"): add a dated `## [0.12.0]` section to
  `apps/scoresheet/CHANGELOG.md` (Added: 15-question quiz format; Changed: timeout message) with a
  `### Bundled contract` line naming `@qzr/shared@1.0.0`, bumped from 0.10.0, and run
  `pnpm bump scoresheet 0.12.0`. Commit it all as `feat(scoresheet): add 15-question quiz format`;
  the pre-commit hook rejects a bump without the staged dated section

**Checkpoint**: a 15-question quiz can be started and scored. Do not release without Phase 5: until
then a 15-question quiz does not survive reload.

---

## Phase 4: User Story 2 - Break a tie in overtime (Priority: P2)

**Goal**: with Overtime on, a tied 15-question quiz gets rounds numbered from 16.

**Independent Test**: score a 15-question quiz to a tie, switch Overtime on: 16 to 18 appear for
the tied teams only; 19 to 21 only if still tied.

### Tests for User Story 2 (write first)

- [X] T034 [P] [US2] Add 15-question cases to `scoresheet/scoring/__tests__/overtime.spec.ts`:
  `computeOvertimeRounds` is 0 until Q1 to Q15 are complete; a tie after 15 gives one round whose
  first question is 16; a second round (19 to 21) only while tied; `getActiveOtTeams` limits it to
  the tied teams; with overtime off no OT columns exist
- [X] T035 [P] [US2] Add 15-question cases to
  `scoresheet/scoring/__tests__/columnVisibility.spec.ts`: OT columns beyond
  `15 + visibleOtRounds * 3` are hidden/orphaned

### Implementation for User Story 2

- [X] T036 [US2] Make T034 and T035 pass; expected to need no change beyond Phase 2. If anything
  still assumes 20/21, fix it in `scoresheet/scoring/overtime.ts` or `columnVisibility.ts`
- [X] T037 [US2] Check `computeInitialOtRounds` in `scoresheet/composables/useScoresheet.ts` builds
  columns with the restored quiz's rules (`quizRules(restored.quiz.format)`), not the current
  quiz's; add a `useScoresheet.spec.ts` case restoring a tied 15-question quiz with overtime on
- [X] T038 [US2] In `pnpm dev`, run quickstart.md step 6 and confirm the regulation-end border sits
  after 15B and OT round styling starts at 16. Commit as
  `test(scoresheet): cover 15-question overtime`. Any fix goes in its own `fix` commit that adds a
  line to the existing 0.12.0 changelog section (no second bump)

**Checkpoint**: US1 and US2 work together.

---

## Phase 5: User Story 3 - Keep a 15-question quiz across save, load, and resets (Priority: P2)

**Goal**: the format survives auto-save, file save/open, resets, and the tutorial; files follow
the version-needed-to-read contract; newer files open only on request.

**Independent Test**: score part of a 15-question quiz, reload, save, open, clear answers, load
teams, press Ctrl+N: still 15-question with the same answers.

### Tests for User Story 3 (write first)

- [X] T039 [P] [US3] Add to `scoresheet/persistence/__tests__/quizFile.spec.ts`
  (contracts/quiz-file.md): a 20-question quiz serializes with `version: 2` and no `quiz.format`; a
  15-question quiz serializes with `version: 3` and `format: '15-question'`; version 1 and 2 files
  deserialize as 20-question and are rejected if they name a format; a version 3 file without
  `format` is rejected; a version 3 file with
  `format: 'nonsense'` is rejected with a message containing `nonsense`; answers at `16A` in a
  15-question file land on the overtime column `16A`; a round trip preserves every quiz field
- [X] T040 [P] [US3] Add newer-file cases to `scoresheet/persistence/__tests__/quizFile.spec.ts`:
  parsing a `version: 4` file throws a distinguishable `NewerFileVersionError` (or equivalent typed
  result); the attempt path parses it as version 3 if it names a known format and version 2 if it
  names none, drops unknown fields, and still rejects an unknown `format`
- [X] T041 [P] [US3] Add to `scoresheet/composables/__tests__/useScoresheet.spec.ts`:
  `clearAnswers` and `clearNames` keep a 15-question format; auto-save then restore yields a
  15-question quiz with the same answers; the opened-from-newer-file flag clears on `resetStore`
  and on any normal `loadFile` but survives a reload; discarding a newer auto-save that paused
  auto-save saves the sheet at once. Unlinking a meet and loading teams from a meet or schedule
  leave the format alone (checked by inspection: they set only division, quiz number,
  consolation, and names)
- [X] T042 [P] [US3] Add to `scoresheet/composables/__tests__/useTutorial.spec.ts`: starting the
  tutorial from a 15-question quiz runs on a 20-question sheet and finishing it restores the
  15-question quiz with its answers; the newer-file warning survives the tutorial and its crash
  recovery, with no stale warning carried over; a newer crash snapshot is set aside, or kept in
  place (listed, and the tutorial won't start until it is discarded) when storage is full
- [X] T043 [P] [US3] Add to `scoresheet/persistence/__tests__/autoSave.spec.ts` (FR-018,
  contracts/quiz-file.md "Newer auto-save"): with a `version: 4` value in `qzr-sheet:current`,
  `loadFromStorage` returns no quiz, moves the value unchanged to a
  `qzr-sheet:newer-autosave:<timestamp>` key, and never deletes it; a second newer value moved
  later gets its own key; a following `saveToStorage` touches only `qzr-sheet:current`; corrupt
  JSON is still handled as today; when storage is too full to move it, it stays under
  `qzr-sheet:current`, auto-save pauses, `clearStorage` leaves it, and discarding it resumes
  saving

### Implementation for User Story 3

- [X] T044 [US3] In `scoresheet/persistence/quizFile.ts` `serialize`: stamp
  `fileVersionFor(quiz.format)` (from T016) and write `quiz.format` only when it is not
  TwentyQuestion, so 20-question files stay byte-compatible with version 2
- [X] T045 [US3] In `scoresheet/persistence/quizFile.ts` `deserialize`: resolve the format
  (`version < 3` means TwentyQuestion and must not name a format, `version 3` requires one), and
  build `validKeys`
  from `buildColumns(quizRules(format), 20)` instead of fixed 20-question columns; return the
  format on the result's `quiz`
- [X] T046 [US3] In `scoresheet/persistence/quizFile.ts` `parseQuizFile`: before `Value.Parse`,
  read the raw `version`; above `FILE_VERSION`, throw `NewerFileVersionError`. Add
  `parseQuizFileAttempt(json)` that re-parses it as the version needed for what this build reads
  (3 with a known format, 2 with none, dropping a 20-question format). Unknown `format` values must
  still fail
- [X] T047 [US3] In `openFile` in `scoresheet/components/Scoresheet.vue` (~667, the `.json`
  branch that calls `parseQuizFile`): on `NewerFileVersionError`, ask via
  `confirmAction("This file was saved by a newer version of the scoresheet. Update to open it
  reliably. Try to open it anyway? Scores may be wrong.")`; on yes, load via
  `parseQuizFileAttempt`, pass it to `loadFile`, then set an `openedFromNewerFile` flag kept in
  `scoresheet/composables/useScoresheet.ts`; on no, change nothing
- [X] T048 [US3] Show a persistent warning badge "Opened from a newer file; may be scored wrong"
  in `scoresheet/components/Scoresheet.vue` while `openedFromNewerFile` is set; clear the flag in
  `resetStore` and at the start of every `loadFile` in `scoresheet/composables/useScoresheet.ts`
  (the attempt path sets it again after loading). Persist it in
  `scoresheet/persistence/openedFromNewerFile.ts` so it survives reloads, and have the tutorial
  carry it across its reset and crash recovery
- [X] T049 [US3] In `scoresheet/persistence/autoSave.ts` `loadFromStorage`: on
  `NewerFileVersionError`, move the raw value unchanged to
  `qzr-sheet:newer-autosave:<new Date().toISOString()>` and return null instead of removing it;
  export `listKeptNewerAutoSaves()` (most recent first) and `discardKeptNewerAutoSave(key)`.
  If storage is too full to move it, keep it in place (`keepNewerInPlace`): list it first, pause
  auto-save while it is `qzr-sheet:current`, and never overwrite or clear it until it is
  discarded. The tutorial's crash recovery uses the same path for a newer snapshot. Other failures
  keep today's handling
- [X] T050 [US3] In `scoresheet/components/Scoresheet.vue`, while any kept newer auto-save exists,
  show a notice ("An auto-saved quiz from a newer version was kept", with the count when more than
  one) offering, for the first listed: **Try to open it** (unsaved-changes confirmation as in
  `openFile`, then the T047 attempt flow on the kept value; the kept original stays) and
  **Discard** (`confirmAction`, then `discardKeptNewerAutoSave`), the only way to remove it. When
  the quiz is pausing auto-save, the notice says so, and Discard saves the sheet at once
- [X] T051 [US3] In `scoresheet/App.vue`, make Ctrl+N (`onNew`) start a new quiz in the current
  quiz's format (research R5): expose a way from `Scoresheet.vue` (e.g. `newQuiz()` with no
  argument repeats `quiz.format`) and keep the menu items explicit
- [X] T052 [US3] Run `pnpm test:unit`, `pnpm type-check`, `pnpm lint`, then quickstart.md steps 7
  to 11 and 13 (step 8 and 9 need a build from master before this feature, e.g. `git worktree add` of
  `origin/master` and `pnpm dev` there). Commit persistence and UI as separate commits, e.g.
  `feat(scoresheet): save quiz format in quiz files` and
  `feat(scoresheet): offer to open newer quiz files`, and
  `feat(scoresheet): keep newer auto-saves`. Each adds its line to the 0.12.0 changelog section
  (Added: format saved in quiz files, newer-file prompt, kept newer auto-saves); no second bump

**Checkpoint**: US1 to US3 complete; this is the minimum releasable set.

---

## Phase 6: User Story 4 - Spreadsheet export unavailable for 15-question quizzes (Priority: P3)

**Goal**: no wrong spreadsheet is ever produced; import still yields 20-question quizzes.

**Independent Test**: on a 15-question quiz the "Export ODS" item is disabled with its reason; on
a 20-question quiz export works; an imported `.ods` is 20-question.

- [X] T053 [P] [US4] Add to `scoresheet/export/__tests__/readOds.spec.ts`: the `QuizFile` built by
  `readOds` deserializes as a 20-question quiz
- [X] T054 [US4] Confirm `scoresheet/export/readOds.ts` stamps
  `fileVersionFor(QuizFormat.TwentyQuestion)` (T016), sets no `format`, and uses
  `TWENTY_QUESTION_RULES` explicitly; no `FILE_VERSION` use remains outside the newer-version check
- [X] T055 [US4] In `scoresheet/components/Scoresheet.vue`, disable "⬡ Export ODS" when
  `quiz.format !== QuizFormat.TwentyQuestion`, with title "Spreadsheet export supports 20-question
  quizzes only" (shared with `fillOts`, which itself refuses non-20-question quizzes, so the
  export layer owns the limit)
- [X] T056 [US4] Run quickstart.md step 12. Add "Changed: ODS export disabled for 15-question
  quizzes" to the 0.12.0 changelog section and commit as
  `feat(scoresheet): no ODS export for 15q quizzes`

**Checkpoint**: all four stories work independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T057 [P] Update `docs/scoring-rules-explained.md`: layout and point rules per format (column
  keys, A/B from 11, error points and 10-point bonuses from 12, quiz-out 3, timeouts until error
  points, overtime from 16), and a new section "Rules not in the rulebook" listing each
  15-question rule from the spec's Context table with its basis: the 20-question rule it shifts,
  the two-team tie-breaker (§2.b) rule it borrows (quiz-out at 3), or practice-meet convention
  (three teams, 2 timeouts, placement formulas unchanged) (FR-014)
- [X] T058 [P] Update `docs/architecture.md`: `scoring/quizRules.ts`, `QuizFormat`,
  `FILE_VERSION` 3 and the version-needed-to-read rule, the newer-file prompt, kept newer
  auto-saves
- [X] T059 [P] Update `CLAUDE.md`: "Column keys" convention per format; gotchas that say
  "`buildColumns(n)` takes an overtime round count" and "`isErrorPoints` is true for Q17–20" now
  describe `buildColumns(rules, overtimeRounds)` and the rules-based boundary. Also fix
  `CONTRIBUTING.md` "Contract package versioning", which places `FILE_VERSION` in
  `apps/scoresheet/src/persistence/quizFile.ts`; it lives in `packages/shared/src/quizFile.ts`
- [X] T060 [P] Add the 15-question quiz to "Available now" in
  `apps/web/src/views/RoadmapView.vue`. This changes the `web` package, so in the same commit add a
  dated `## [0.12.2]` section to `apps/web/CHANGELOG.md` (Changed: roadmap lists 15-question
  quizzes) with `### Bundled contract` naming `@qzr/shared@1.0.0`, bumped from 0.10.0, and run
  `pnpm bump web 0.12.2`. Commit as `docs(web): list 15-question quizzes as available`
- [X] T061 Commit T057 to T059 as `docs: describe the 15-question quiz format` (T060 is its own
  `web` commit)
- [X] T062 Check the release sections are complete: `apps/scoresheet/CHANGELOG.md` 0.12.0 lists
  every observable change from T033, T038, T052, and T056, and its date is today (update it in a
  fixup to the T033 commit if the branch spans several days); `apps/web/CHANGELOG.md` 0.12.2 and
  `packages/shared/CHANGELOG.md` 1.0.0 are present. No further bumps
- [X] T063 Final gate: `pnpm test:unit`, `pnpm type-check`, `pnpm lint` all pass; walk
  quickstart.md end to end once more. Before merging, rebase onto current `origin/master` (the
  branch bumps versions; constitution, Development Workflow) and re-run the three checks

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** → **Phase 2** → stories. Phase 2 is strictly sequential: T002 to T013 form one
  refactor commit, T015 to T017 one contract commit, then T018 to T020.
- **US1 (Phase 3)** needs Phase 2.
- **US2 (Phase 4)** needs US1's FifteenQuestion row (T028) to have anything to test.
- **US3 (Phase 5)** needs Phase 2; its 15-question cases need T028.
- **US4 (Phase 6)** needs Phase 2 only (`fileVersionFor` arrives in T016).
- **Polish (Phase 7)** after all stories; T062 last but one.

### Within each story

Tests first and failing, then implementation, then the story's manual quickstart steps, then
commit.

### Parallel opportunities

- T021 to T027 (US1 tests): different spec files, all [P].
- T034, T035 (US2 tests) and T039 to T043 (US3 tests) can be written in parallel with each other
  once T028 lands.
- T053 (US4 test) in parallel with US3 implementation.
- T057 to T060 (docs) in parallel.

### Parallel example: User Story 1

```text
Task: "T022 Create scoresheet/types/__tests__/buildColumns.spec.ts (15-question layout)"
Task: "T023 Add 15-question cases to scoresheet/scoring/__tests__/scoreTeam.spec.ts"
Task: "T024 Add 15-question cases to validation.spec.ts and greyedOut.spec.ts"
Task: "T025 Add resetStore/timeout cases to useScoresheet.spec.ts"
```

---

## Implementation Strategy

### MVP

Phases 1, 2, 3 (US1) give a scorable 15-question quiz, but US3 is what makes it safe to ship: a
15-question quiz must not revert to 20 on reload. **Release US1 and US3 together.** US2 and US4
are small and ride in the same pull request.

### Incremental delivery

1. Phase 2 lands with no behaviour change; every existing test proves it (SC-003).
2. US1: format exists and scores correctly.
3. US2: overtime verified.
4. US3: persistence and file compatibility.
5. US4: ODS guard.
6. Docs and the web roadmap entry, then one pull request (feature-sized, per CONTRIBUTING.md).

### Out of scope (surfaced, not fixed here)

- `quizStore.loadState` does not copy `bonusRule`: #78.
