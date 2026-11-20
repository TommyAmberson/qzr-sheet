---

description: "Tasks for the ODS round trip"
---

# Tasks: ODS round trip for meet results

**Input**: Design documents from `specs/009-ods-round-trip/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the implementation
task names the test task or existing test that covers it.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing
of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 to US3)

<!--
  ============================================================================
  TASK WRITING RULES (project override; constitution principle VII)
  These rules and the constitution override the speckit-tasks skill's
  defaults: tests are not optional where the testing principle calls for
  them, and stories are not ordered Models -> Services -> Endpoints.
  Keep this comment in the generated tasks.md, so commands that add tasks
  later (/speckit-converge) see the same rules.

  - Describe the behaviour, and the test that proves it where the testing
    principle calls for one, not the code. Name a function, signature, option,
    or literal only when the task changes an existing one or the spec,
    data-model.md, or contracts/ already fixes it. Let implementation choose new names; naming the file a change
    lands in is fine.
  - Every decision or write path the feature adds has one owner, named in
    plan.md's "Reuse and Ownership" table. A task that touches it points at that
    owner; never split one rule's implementation across several tasks or files.
  - Reuse first. A task that adds a helper, module, type, or test fixture names
    the existing code it checked and why that doesn't fit. Test tasks extend
    existing fixtures and stubs rather than copying them.
  - No speculative surface: every new production export has a caller the
    constitution accepts, and no task adds an option, reason code, or counter
    that only a test reads.
  - Don't specify framework or library defaults; plan.md records what the
    platform already provides.
  - Name the packages a release bumps and the semver level of each, never the
    resulting version number. The number is set when the bump commit is
    written, from master at that time, and a hotfix landing first takes it.
  - Prefer one task per coherent change over one task per layer (model, then
    service, then endpoint). Split only where tasks can genuinely run or be
    reviewed apart.
  ============================================================================
-->

## Phase 1: Setup

**Purpose**: Put the ODS code where every app reaches it.

- [X] T001 Move `readOds.ts`, `fillOts.ts` and `odsXml.ts` with their tests from `apps/scoresheet/src/export/` to `packages/shared/src/ods/`, export them from `packages/shared/src/index.ts`, move the `fflate` dependency into `packages/shared/package.json` (keep it in the scoresheet only if the scoresheet still imports it directly), and point the scoresheet's imports at `@qzr/shared` (research R1). No behaviour change; covered by the moved `readOds.spec.ts`, `fillOts.spec.ts`, `odsXml.spec.ts`
- [X] T002 Bump `packages/shared/package.json` MINOR with a dated changelog section in `packages/shared/CHANGELOG.md` that later shared changes in this branch extend (Principle V)

---

## Phase 2: Foundational

**Purpose**: The meet's template, which every `.ods` download and the scoresheet's export use.

**⚠️ CRITICAL**: The `.ods` half of US2 waits on this phase; `.json` work does not.

- [X] T003 Add the meet template table to `packages/api/src/db/schema.ts` per data-model.md (`meetId` integer key, one row per meet, "Deleted with the meet"; `fileName` text; `bytes` blob; `uploadedAt` timestamp; `uploadedById` account, nullable, "kept null if that account goes"), then generate the migration with `pnpm --filter @qzr/api db:generate`
- [X] T004 Write failing API tests for the template routes in a new spec beside the route (extending `packages/api/src/test-utils.ts` and the existing route test setup in `packages/api/src/routes/__tests__/`): admin `PUT` stores and replaces; a non-template `.ods` and a file over 2 MB are refused with `400`; `PUT` is refused in `done` and for non-admins; `GET` serves bytes with `Content-Disposition` and `Last-Modified` to a viewer once the meet is `live`, to the meet's officials (account and guest token) and to admins, and refuses others with `403`; `404` with no template; `HEAD` answers without the body (contracts/api.md)
- [X] T005 Implement the template routes in `packages/api/src/routes/` per contracts/api.md, owned as plan.md's "Storing and serving the meet's template", reusing `isAdminOrSuperuser`, the officials check and the full-roster read rule in `packages/api/src/lib/permissions.ts`, and the ODS module's Quiz sheet lookup to refuse non-templates (research R3); mount it so `routeMountOrder.spec.ts` still passes; covered by T004
- [X] T006 Add the template to the meet page in `apps/web/src/views/QuizMeetView.vue`: "Download scoring template" for everyone FR-013a allows (full-roster readers, the meet's officials, admins), shown only when a template exists (from `HEAD`), which is how a room falls back to spreadsheets (SC-002); and for admins, upload and replace, showing the current template's name and date and the API's refusal message; with the portal's API calls added to `apps/web/src/api.ts` beside the existing meet calls
- [X] T007 Document the template table in `docs/data-model.md` and who may download and replace it in `docs/roles-and-access.md` (Principle II)

**Checkpoint**: A meet can hold a template.

---

## Phase 3: User Story 1 - Upload ODS sheets to the meet (Priority: P1) 🎯 MVP

**Goal**: The shared upload, in the portal and the scoresheet, accepts `.ods` beside `.json`, and
re-uploads of unchanged quizzes are quiet.

**Independent Test**: Upload a mix of `.ods` and `.json` for a meet; each readable file is stored
and listed; unreadable ones are refused with a reason; uploading the same files again reports every
one unchanged with no prompt.

### Tests for User Story 1

- [X] T008 [P] [US1] Add a failing case to `packages/shared/src/ods/__tests__/readOds.spec.ts`: a sheet with `mb` on a seat that has no quizzer reads as a no-jump on that question's column and no mark in the empty seat (spec FR-005, research R8), extending the existing sheet fixtures
- [X] T009 [P] [US1] Add failing cases to `packages/api/src/routes/__tests__/results.spec.ts`: sending a file identical to the quiz's current revision answers `200` with `unchanged: true` and adds no revision whatever `onExisting` says, including when the current revision is a restore; a changed file still gets today's `409` (contracts/api.md)
- [ ] T010 [P] [US1] Add failing cases to `apps/web/src/__tests__/sendQuizzes.spec.ts`: an `.ods` in the batch is read and sent like a `.json`; a file that is neither is reported refused with a reason and the rest are still sent; an unchanged answer is reported as unchanged and asks nothing; answering the first "already stored" question with "apply to the rest" answers every later one in the batch

### Implementation for User Story 1

- [X] T011 [US1] Make `readOds` turn an `mb` on an empty seat into a no-jump on that column, with a comment that allowing `mb` on an empty seat directly is a later option, in `packages/shared/src/ods/readOds.ts`; extend the shared changelog section; covered by T008
- [X] T012 [US1] Answer an identical file as unchanged in `results.post('/:id/results')` in `packages/api/src/routes/results.ts`, before `alreadySubmitted`, comparing against the current revision's file as the restore path does (research R6); covered by T009
- [ ] T013 [US1] Read `.ods` files, report unchanged files, and offer "apply to the rest" on the batch's "already stored" question in `packages/ui/src/sendQuizzes.ts` (`uploadPicked`, `sendOne`, `askAlreadySubmitted`), and widen the file inputs to accept `.ods` in `apps/web/src/views/ResultsView.vue` and `apps/scoresheet/src/components/Scoresheet.vue`; covered by T010
- [ ] T014 [US1] Show unchanged and refused outcomes in the upload report of `apps/web/src/views/ResultsView.vue` and the scoresheet's upload report, reusing the existing `FileReport` list

**Checkpoint**: A whole meet's sheets can be uploaded from either app (one room per batch, as
today).

---

## Phase 4: User Story 2 - Download stored quizzes as files (Priority: P1)

**Goal**: Stored quizzes come back out as `.json` or `.ods`, singly or as one archive.

**Independent Test**: Download one quiz as `.ods` and open it in LibreOffice: marks and totals match.
Download the meet as `.json`, upload those files to a fresh copy of the meet: same standings and
stats.

### Tests for User Story 2

- [ ] T015 [P] [US2] Add failing cases to `apps/web/src/__tests__/results.spec.ts` for the archive contents built from a results list: one file per quiz, named by the scoresheet's file stem, unique across divisions; a division's archive holds only that division; a 15-question quiz is left out of an `.ods` archive and listed; a quiz past Q26 is filled through Q26 and listed with the questions left out; an empty list builds nothing (spec FR-009, FR-010, FR-016)
- [ ] T016 [P] [US2] Add a round-trip case to `packages/shared/src/ods/__tests__/fillOts.spec.ts`, extending its template fixture: a 20-question quiz with errors on A/B questions and two overtime rounds, filled with `fillOts` and read back with `readOds`, gives the same scores, placements and marks (spec FR-011, SC-005); and reading the filled sheet a second time gives an identical quiz, so a re-upload is unchanged (FR-003a)

### Implementation for User Story 2

- [ ] T017 [US2] Move the scoresheet's file stem (`fileStem` in `apps/scoresheet/src/components/Scoresheet.vue`) to `packages/shared` beside `quizName`, so the portal names files the same way (research R12); the scoresheet keeps its behaviour; extend the shared changelog
- [ ] T018 [US2] Build downloads in the portal from the stored quizzes `GET /api/meets/:id/results` already returns (research R4): one quiz as `.json` (its current `quizFile`) or `.ods` (`fillOts` with the meet's template), and a meet's or a division's quizzes as one zip of either, with the warnings of FR-016, in `apps/web/src/` beside `results.ts`; covered by T015
- [ ] T019 [US2] Add download controls to `apps/web/src/views/ResultsView.vue`: per quiz, and for the meet or a division; with no template, `.ods` says an admin needs to upload one and `.json` stays available (FR-014); a 15-question quiz offers `.json` only
- [ ] T020 [US2] Add downloads to the quiz's own page, `apps/web/src/views/ResultView.vue`: the current revision as `.json` or `.ods`, and each past revision from its revision view, fetched through the existing `GET /api/meets/:id/results/:resultId/revisions/:revision`, using T018's download code (spec Story 2, Edge Cases)
- [ ] T021 [US2] Use the meet's template for Export ODS in `exportOds` in `apps/scoresheet/src/components/Scoresheet.vue` when the quiz is linked to a meet that has one, with "another template…" opening today's picker, and the picker as the fallback with no template, no link or no network (FR-015, research R11, Principle I)

**Checkpoint**: A meet can move back to spreadsheets one quiz or all at once.

---

## Phase 5: User Story 3 - Match an uploaded sheet to its scheduled quiz (Priority: P2)

**Goal**: Before sending, each file shows the scheduled quiz and room it will be stored as, and an
admin sends one batch across many rooms.

**Independent Test**: Upload a batch where one sheet names a quiz the schedule doesn't have: it is
marked unmatched, the uploader picks its quiz, and it is stored as that quiz in that quiz's room;
two sheets of one quiz are flagged before sending.

- [ ] T022 [P] [US3] Add failing cases to `apps/web/src/__tests__/sendQuizzes.spec.ts`: files whose quiz names match the published schedule are paired with their scheduled quiz and room; an unmatched one can be given a scheduled quiz, which rewrites its division, consolation and number before sending, or sent unlinked; duplicates in a batch are flagged; an admin's batch sends each quiz with its scheduled quiz's `roomId` and `scheduleQuizId`; a "Div 1" division shows as one the meet lacks
- [ ] T023 [US3] Add the batch review to the shared upload in `packages/ui/src/sendQuizzes.ts`, matching by `resultKey`/`resultName` against the published schedule (research R7), replacing the single `chooseRoom` for an admin's batch with each quiz's scheduled room (FR-007), and sending an unmatched or unlinked sheet in an admin's batch with no room, while an official keeps their own room; covered by T022
- [ ] T024 [US3] Show the review before sending in `apps/web/src/views/ResultsView.vue` and the scoresheet's upload, with a picker of the schedule's quizzes for unmatched files

**Checkpoint**: A 75-quiz backfill goes in as one batch, each quiz in its own room.

---

## Phase 6: Roster import found failing on a real meet

**Purpose**: FR-017. Independent of the stories; can run any time. (FR-018, the other defect that
import hit, is fixed by #200.)

- [ ] T025 [P] Add failing cases to `packages/api/src/routes/__tests__/churches.spec.ts`: a 60-team, 300-quizzer roster imports in one call; an import that fails partway (for example a quizzer row the database refuses) leaves no churches, teams or quizzers, and answers with an error message (contracts/api.md)
- [ ] T026 Make the roster import in `churches.post('/meets/:meetId/roster/import')` in `packages/api/src/routes/churches.ts` one batch through `asOne`, with every insert chunked by `chunksOf`, and later rows finding earlier rows' ids by sub-select on their natural keys (research R10), reusing `batchCreateQuizzers`; covered by T025
- [ ] T027 Reload the roster after every import attempt, failed or not, and show the API's message, in `handleRosterFile` in `apps/web/src/views/QuizMeetView.vue`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T028 [P] Update `docs/ods-format.md` (the code's new home, the meet template, the empty-seat `mb` reading) and `docs/architecture.md` (downloads built in the browser, uploads one `POST` per quiz)
- [ ] T029 [P] Move #52 in `ROADMAP.md` and the matching entry in `apps/web/src/views/RoadmapView.vue` to available once the feature is in
- [ ] T030 Bump api MINOR, web MINOR and scoresheet MINOR with changelog sections naming the bundled shared version under `### Bundled contract`
- [ ] T031 Run `pnpm test:unit`, `pnpm type-check` and `pnpm lint`, then walk quickstart.md's scenarios on local dev with a real meet's sheets kept outside the repository

---

## Dependencies & Execution Order

- Phase 1 (T001, T002) before everything: the ODS code must be in `@qzr/shared`.
- Phase 2 (template) before the `.ods` parts of US2 (T018 to T021).
- US1 (Phase 3) needs only Phase 1. It is the MVP.
- US2's `.json` downloads need only Phase 1; its `.ods` ones need Phase 2.
- US3 builds on US1's upload changes in `sendQuizzes.ts` (T013).
- Phase 6 (T025 to T027) needs nothing.
- #200 (`fix/papercuts`) changes `sendQuizzes.ts`, `ResultView.vue`, `ResultsView.vue`,
  `RoadmapView.vue` and a few lines of `Scoresheet.vue`, and delivers FR-018. Rebase onto master
  once it merges, before T020, T023 and T029; expect small conflicts in T001, T013, T017, T019 and
  T021 if they land first. FR-018 is checked only after that rebase.
- Phase 7 last.

Within a phase, a test task comes before the task it covers, and fails first.

## Parallel Opportunities

- T008, T009, T010 (three test files) together; then T011, T012 in parallel, T013 after.
- T015 and T016 (two test files) together, before T018.
- Phase 6 alongside any story: T025 first, then T026 and T027.
- T028, T029 together.
- With Phase 2 done, US2 and US1 can proceed side by side: they touch different files apart from
  `ResultsView.vue`.

## Implementation Strategy

1. Phase 1, then US1: `.ods` uploads in both apps. Ship-ready on its own (MVP).
2. Phase 6: the roster fix, so a real meet can be loaded and checked.
3. Phase 2 and US2: the way back to spreadsheets.
4. US3: one batch across rooms, for backfills.
5. Polish, releases, quickstart walk-through.
