---

description: "Task list for practice meet results"
---

# Tasks: Practice meet results

**Input**: Design documents from `/specs/003-practice-meet-results/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/results-api.md

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the implementation task names the test task or existing test that covers it.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- pnpm monorepo: `packages/shared/src/`, `packages/api/src/`, `apps/scoresheet/src/`, `apps/web/src/`
- Tests live in `__tests__/` beside the code they cover

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

## Delivery

Six pull requests, each opened only with the user's approval (research R14):

1. Phases 1 and 2: scoring moves to `packages/shared` (no behaviour change)
2. Phase 3: User Story 1
3. Phase 4: User Story 2
4. Phase 5: User Story 3
5. Phase 6: User Story 4
6. Phases 7, 8 and 9: User Stories 5 and 6, and polish

Each pull request rebases onto master first and carries its own release bumps.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Let `packages/shared` run tests, so scoring specs can move with their code (R3)

- [X] T001 Give `packages/shared` a vitest setup and a `test:unit` script, modelled on `packages/api`'s, and include it in the root `test:unit` run in `package.json`; it passes with no specs yet

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Move scoring into `packages/shared` without changing behaviour (R1, R2), so the portal can score stored quiz files. First pull request.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Move `apps/scoresheet/src/scoring/` (all eight modules), `apps/scoresheet/src/types/scoresheet.ts` and `apps/scoresheet/src/types/indices.ts`, with their specs, into `packages/shared/src/`, export them from `packages/shared/src/index.ts`, and point every scoresheet import at `@qzr/shared`. No logic changes; the moved specs and every scoresheet spec pass unchanged
- [X] T003 Move the pure parts of `apps/scoresheet/src/persistence/quizFile.ts` (parsing, version checks, the newer-file error, `deserialize`, `serialize`) into `packages/shared/src/quizFile.ts` beside `QuizFileSchema`, with their spec cases; `serializeStore` stays in the scoresheet because it reads the store. Covered by the moved `persistence/__tests__/quizFile.spec.ts` cases (Done in a module of its own, `packages/shared/src/quizFileCodec.ts`, to keep the schema module free of an import cycle with the column types; the quiz file spec stays in the scoresheet because it builds its files from a store.)
- [X] T004 Make building `cells[team][seat][col]` from a quiz's teams, quizzers and answers one shared function (plan: Reuse and Ownership), taken from `quizStore.cellGrid`; `apps/scoresheet/src/stores/quizStore.ts` and `apps/scoresheet/src/export/fillOts.ts` both call it, removing `fillOts`'s copy. Covered by a new spec in shared plus the existing quizStore and fillOts specs
- [X] T005 Move the placement gate (regulation complete, no validation errors, no timeout errors), the timeout checks, placements and placement points out of `apps/scoresheet/src/composables/useScoresheet.ts` into one shared function in `packages/shared/src/scoring/`; `useScoresheet` derives `placements`, `placementPoints` and its timeout errors from it. Covered by a new shared spec using the hand-scored quiz in the moved `fifteenQuestionQuiz.spec.ts`, plus the existing `useScoresheet` specs unchanged (Done as one shared `assessQuiz`, which also owns the grey-out and validation inputs the gate needs, so the composable reads every one of those results from it.)
- [X] T006 Release the move: bump shared MINOR with a dated changelog section listing the new exports, and release the scoresheet as `CONTRIBUTING.md` requires for a refactor, naming the bundled shared version under `### Bundled contract` (Done in the move's first commit, as the pre-commit contract check requires; later commits extended the changelogs.)
- [X] T007 Update `docs/architecture.md` and `CLAUDE.md` for scoring living in `packages/shared`, and amend principle III's path in `.specify/memory/constitution.md` as a PATCH amendment (the principle already anticipates the move), bumping the constitution's version line and sync notes, in its own commit

**Checkpoint**: `pnpm test:unit`, `pnpm type-check` and `pnpm lint` pass; the scoresheet behaves exactly as before

---

## Phase 3: User Story 1 - Submit a quiz to the meet (Priority: P1) 🎯 MVP

**Goal**: Officials submit quizzes from a scoresheet joined to a room; the admin lists them by division

**Independent Test**: Quickstart scenarios 1 and 2

### Tests for User Story 1

> **NOTE: Where a task adds a new test, write it first and see it fail.**

- [X] T008 [US1] Write route specs in `packages/api/src/routes/__tests__/results.spec.ts` for `POST /results`, `PUT /results/:id` and `GET /results` as [contracts/results-api.md](./contracts/results-api.md) states: a guest official's submit stored as `submitted` with its room; a name already submitted, from the same room or another, reported with its current revision and who saved it, then added as a revision with `newRevision` or `keepCurrent`; names matched ignoring case and spaces, with consolation kept apart; an admin's save stored as `edited`, and a rename onto another quiz's name refused; a signed-in official must name one of their rooms; invalid file 400; newer file 422 with the scoresheet's message; a token without a room, or from a rotated code, refused with "Rejoin with your room code"; viewers and other meets refused. Extend `src/test-utils.ts` (`seedMeet`, `mockSession`) rather than adding fixtures

- [X] T009 [P] [US1] Write a shared spec for the quiz outcome in `packages/shared/src/scoring/__tests__/`, starting from the hand-scored quiz in the moved `fifteenQuestionQuiz.spec.ts`: each team's name, score, place, placement points and error count, errors counting every error whether or not it cost points and no fouls (FR-011); a quiz with unanswered regulation questions or validation errors can't be placed (R12)

### Implementation for User Story 1

- [X] T010 [US1] Add the stored quiz (`quiz_results`) and quiz version (`quiz_result_revisions`) tables to `packages/api/src/db/schema.ts` exactly as [data-model.md](./data-model.md) lists them ("counted; starts false", "revision 1, 2, 3, … per stored quiz; unique within it", "action: submitted, uploaded, edited, merged, or restored", room "cleared if the room is deleted"), generate the migration with `pnpm --filter @qzr/api db:generate`, and add matching DDL to `packages/api/src/test-db.ts`
- [X] T011 [US1] Put the room's id on official guest tokens at join (R4) in `packages/api/src/lib/jwt.ts` and `packages/api/src/routes/join.ts`; viewer tokens unchanged. Covered by a case added to the existing join route spec
- [X] T012 [US1] Implement `POST /results`, `PUT /results/:id` and `GET /results` in a new `packages/api/src/routes/results.ts`, mounted in `packages/api/src/index.ts` where guest tokens reach it (a new router because the schedule routers require an account session, so guest officials can't reach them). Authorisation per the contract, with the official-of-room check beside the helpers in `packages/api/src/lib/permissions.ts`; files validated with the shared parser (R6); who and how taken from the caller (R7); a revision-number race retried with the next number. Covered by T008 (Each revision also keeps the saver's name as it was, so the trail survives a renamed or deleted room or account, and a quiz's current revision is its newest revision row rather than a stored number; recorded in data-model.md and the contract. Submissions are matched to a stored quiz by name (R8), officials resubmit through `POST`, and `PUT` is for admins. Official tokens carry a tag of the room's current code, so rotating it revokes them.)
- [X] T013 [US1] Implement the quiz outcome (per team: name, score, place, placement points, error count, or can't be placed) as shared scoring in `packages/shared/src/scoring/`, built on the T005 placement function and the moved `scoreTeam`; the portal's list (T015) is its first caller. Covered by T009 (Allocating a loaded quiz's overtime columns and deciding which seats are empty became shared helpers too, now also used by the scoresheet.)
- [X] T014 [US1] Add submitting to the scoresheet: a Submit entry in the Save menu of `apps/scoresheet/src/components/Scoresheet.vue`, shown only to an official of the meet session's meet (admins add quizzes by uploading, T023, and save opened ones, T028). Officials reach a meet session through the existing "Load teams from meet" dialog and its "Have a code?" join, which must work for a meet with no teams. Loading or refreshing a meet in `apps/scoresheet/src/composables/useMeetSession.ts` works out whether the user officiates it, a signed-in account first, with its rooms from `GET /api/my-meets`, which now lists `roomId`; a signed-in official of several rooms in the meet picks one when submitting. Submit is refused with the validation reason while `hasAnyErrors`, and confirms success. The meet knows a quiz by its name (R8), so the scoresheet keeps no stored-quiz reference: a name already submitted offers the three choices (FR-003). New quiz keeps the meet link and clears only the quiz's teams; a failed submit says so and changes nothing (FR-004). A guest official's request carries the token for the sheet's meet. API calls in `apps/scoresheet/src/api.ts`. Covered by new cases in the `useMeetSession` spec and a spec for the choice dialog, which both questions share
- [X] T015 [US1] Add the admin's results list to the portal: a route under `/:slug` in `apps/web/src/router/index.ts`, a view in `apps/web/src/views/`, a link from `QuizMeetView.vue` shown to admins (`meetAccess.isAdminOrSuperuser`), and the call in `apps/web/src/api.ts`. Quizzes grouped by the division in each file, showing quiz number, room, team names and scores (via the shared quiz outcome, T013), revision number, last editor and time, and whether counted (FR-006). Covered by a spec in `apps/web/src/__tests__/` for the grouping and row summary
- [X] T016 [US1] Amend `docs/data-model.md` (the two tables), `docs/auth.md` (room claim) and `docs/roles-and-access.md` (official submit, admin results access); release shared MINOR (the quiz outcome), and api, scoresheet and web MINOR, each naming its bundled shared version

**Checkpoint**: Quickstart scenarios 1 and 2 pass

---

## Phase 4: User Story 2 - Division standings and finalists (Priority: P1)

**Goal**: Admins count quizzes and read each division's ranking with finalists

**Independent Test**: Quickstart scenario 3

### Tests for User Story 2

- [X] T017 [P] [US2] Write shared specs for the standings in `packages/shared/src/scoring/__tests__/`, building divisions from the T009 outcome fixtures: totals and order against a hand calculation (FR-010); head-to-head with two and with three tied teams, never met, and level (FR-011a); total points then fewest errors (FR-011); a tie surviving every criterion shares a rank, and one at the finalist cutoff is flagged naming the teams (FR-012); fewer than three teams all finalists; warnings for unequal quiz counts and an unplaceable quiz that adds nothing and isn't counted as one of its teams' quizzes (FR-014, R12); divisions grouped as written; names folded for case and spaces, shown under the most-used spelling with a tie going to the spelling seen first (FR-015) (Most cases build quiz outcomes directly, so each tie-break can be set up exactly; one case scores the hand-scored fixture file end to end.)
- [X] T018 [P] [US2] Write route specs in `packages/api/src/routes/__tests__/results.spec.ts` for `PATCH /results/counted`: only admins; one counting record per quiz whose value changes; an id outside the meet changes nothing

### Implementation for User Story 2

- [X] T019 [US2] Add the counting record table (`quiz_result_count_changes`) to `packages/api/src/db/schema.ts` as [data-model.md](./data-model.md) lists it, via `db:generate`, with DDL in `packages/api/src/test-db.ts`, add the table to `docs/data-model.md`, and implement `PATCH /results/counted` in `packages/api/src/routes/results.ts`. Covered by T018 (Whether a quiz counts is its newest counting record, so the value and its record are one insert and can't disagree; the migration drops the `counted` column, which nothing could set before. Each record also keeps the admin's name, like revisions.)
- [X] T020 [US2] Implement the division standings (FR-010 to FR-015 except look-alike names, R12) as shared scoring in `packages/shared/src/scoring/`, built on the quiz outcome (T013). Covered by T017 (Teams still tied after a tie-breaker splits a tie start again from head-to-head; `foldName` in shared is the one folding rule for team names and the API's quiz keys.)
- [X] T021 [US2] Add counted toggles with select all and deselect all to the portal's results list, and a standings view per division in `apps/web/src/views/` showing totals, quiz counts, rank, the deciding tie-break, finalists, and warnings, computed with the shared standings from the counted quizzes' current files. Covered by T017 for the logic The Room column must not show a deleted room's quizzes as uploaded (#104). (The standings sit above the quiz list on the Results page rather than on a route of their own, so counting a quiz updates them at once. Each quiz shows where it came from, its first revision's room or uploader, which outlives a deleted room (#104), and its name from the shared `quizName`, so consolation quizzes stay apart.)
- [X] T022 [US2] Document the standings in `docs/scoring-rules-explained.md`, listing the tie-breakers applied to every prelim tie and what "fewest errors" counts as rules not in the rulebook; release shared, api and web MINOR, naming the bundled shared version

**Checkpoint**: Quickstart scenario 3 passes

---

## Phase 5: User Story 3 - Upload saved quiz files (Priority: P2)

**Goal**: Admins and officials upload quiz files from rooms that couldn't submit, from the scoresheet or the portal; officials reach the portal with their room code; admins submit from the scoresheet for any room

**Independent Test**: Quickstart scenario 4

### Implementation for User Story 3

- [X] T038 [US3] Extend `POST /results` in `packages/api/src/routes/results.ts` as [contracts/results-api.md](./contracts/results-api.md) states: `upload: true` records the action `uploaded`; an admin may name any room of the meet (recorded as "Pat, Room 2", action `submitted`) or none (action `edited`, or `uploaded` with `upload`); the room it is sent for gets access to the stored quiz, whose rooms are those its revisions were saved for. `GET /results` lets an official list only the quizzes of the rooms they officiate. Covered by new cases in `packages/api/src/routes/__tests__/results.spec.ts`: an admin naming a room, another meet's room refused, `upload` labels, an official's list limited to quizzes with a revision saved for one of their rooms (a signed-in official of two rooms sees both, and saving another room's quiz name adds that quiz to their list), a viewer refused
- [X] T023 [US3] Move the scoresheet's guest session module (`apps/scoresheet/src/composables/guestSession.ts`, with its spec) and its choice dialog (`ChoiceDialog.vue`, with its spec) into `packages/ui`, beside `SignInForm`, and use them from the scoresheet unchanged. The "already submitted" question (title, detail and the three choices) moves beside the dialog, so both apps ask it the same way. The module takes its join call from the app, as `SignInForm` takes its auth client, since `packages/ui` can't import either app's API. The portal keeps the guest session from its "join with a code" flow (the `TODO` in `HomeView.vue`) and sends the token for that meet's requests (R15). The quiz's name in the scoresheet's two file-name stems in `Scoresheet.vue` comes from the shared `quizName` (The moved modules' specs stay in the scoresheet, importing `@qzr/ui`, as `SignInForm`'s does, since `packages/ui` has no test runner. The question, the room choice and the one-at-a-time sending loop live together in `packages/ui/src/sendQuizzes.ts`.)
- [X] T039 [US3] In the scoresheet: an "Upload file to meet" entry in the Save menu, for officials and admins of the linked meet, picks one or more saved `.json` files and sends each as `POST /results` with `upload: true`, without opening it. The room is chosen first: an official of several rooms picks one; an admin picks any room of the meet or "No room". Files go one at a time, in the order picked; each name the meet already has asks the three choices in turn, and skipping one moves on to the next; a report lists each file's result, with the server's reason when refused. An admin's Save to meet sends the sheet by name the same way as an official's Submit (R8), after the same room choice; loading or refreshing a meet asks `GET /results/sender` who the user is, an admin with every room of the meet or an official with their rooms, decided the way the routes decide it, so the scoresheet doesn't work it out from memberships. Covered by new cases in the `useMeetSession` spec
- [X] T040 [US3] In the portal: the Results page gets an upload area for admins and officials (R13, the roster CSV import's hidden-input pattern in `QuizMeetView.vue`), with the same room choice, one-at-a-time sending, three choices per existing name, and per-file report as the scoresheet (T039), reusing the `packages/ui` dialog and question. Officials, signed in or by room code, reach the Results page for the meets they officiate and see the upload area and their rooms' quizzes, without counting or standings (FR-018): the router admits a guest session for that meet on the meet page and its Results page (today every `/:slug` route needs an account), and the meet page shows Open results to the meet's officials as well as its admins, from the meet page's own membership role (`isOfficial` in `QuizMeetView.vue`); the Results page asks `GET /results/sender` who the user is. Covered by a case in the results-list spec for the per-file report (A guest official who joins in the portal is taken straight to the meet's results, the one meet page the router admits a guest session to; the meet page itself still needs an account and links signed-in officials to the results.)
- [X] T041 [US3] Amend `docs/roles-and-access.md` (officials upload and list their rooms' quizzes; admins submit for any room) and `docs/auth.md` (the portal keeps a guest session too); release api, scoresheet and web MINOR, naming the bundled shared version

**Checkpoint**: Quickstart scenario 4 passes

---

## Phase 6: User Story 4 - Correct a quiz, with a paper trail (Priority: P2)

**Goal**: Admins, and officials for their rooms' quizzes, edit names and details, fix answers in the scoresheet, and see and restore history

**Independent Test**: Quickstart scenarios 5 and 6

### Tests for User Story 4

- [ ] T024 [US4] Write route specs in `packages/api/src/routes/__tests__/results.spec.ts` for `GET /results/:id/revisions`, `GET /results/:id/revisions/:revision`, `POST /results/:id/restore`, and `PUT /results/:id` for officials: history lists saves and counting records newest first with who, when and how; restore adds a `restored` revision naming its source and keeps every newer one (FR-005a); viewing a restoring revision returns the file it restores, with `restoredFrom`; restoring a restoring revision points the new one at the revision with the file; restoring the content already current adds no revision and returns the current one; each route is for admins and the quiz's room officials only (any room a revision was saved for), so an official of a room that never saved it is refused; an official of several rooms editing or restoring is recorded for a room the quiz already has

### Implementation for User Story 4

- [ ] T025 [US4] Implement the three routes in `packages/api/src/routes/results.ts`, adding restores through the same revision insert that Submit's keep-current uses, so a restore resolves to a revision with a file, and let the quiz's room officials `PUT` it, through one check beside the official-of-room check (plan: Reuse and Ownership). A room official's edit or restore is recorded for one of their rooms the quiz already has, the first by room order, so it never gives the quiz a new room. Covered by T024
- [ ] T026 [US4] Add the quick form to the portal's results list, for admins and the quiz's room officials: change team names, quizzer names, division and quiz number of a stored quiz by editing its file (shared `deserialize` and `serialize`) and saving it with `PUT /results/:id`. This view is the one owner of name edits in stored files; merge (T031) reuses it. Covered by a spec of the file edit in `apps/web/src/__tests__/`. A rename onto another stored quiz's name is refused with 409; the form shows that reason and leaves the quiz unchanged.
- [ ] T027 [US4] Add each quiz's history to the portal, for admins and the quiz's room officials: its saves and counting records with who, when and how, each revision's teams and scores via the shared quiz outcome, Restore, and Open in scoresheet for the current or an earlier revision. A restoring revision shows as "restores revision N", with that revision's teams and scores. Show the date with each save, not only the time (the results list shows only the time, enough on the day of a one-day meet)
- [ ] T028 [US4] Let the scoresheet open a stored quiz from the portal link, extending its existing URL-parameter handling in `apps/scoresheet/src/components/Scoresheet.vue` (R9): fetch the revision with the admin's session or the official's guest token, ask before replacing unsaved work, load it through the shared parser, and link the sheet to the quiz's meet. Save to meet sends it by name (T039, R8): the stored quiz's name gets the "already submitted" choices, and a quiz renamed in the sheet becomes a new quiz rather than renaming the stored one. Renames belong to the portal's quick form (T026). Covered by a new case in the component spec
- [ ] T029 [US4] Release api, scoresheet and web MINOR, naming the bundled shared version

**Checkpoint**: Quickstart scenarios 5 and 6 pass

---

## Phase 7: User Story 5 - Merge look-alike team names (Priority: P3)

**Goal**: The standings flag look-alike names; one action merges them across a division

**Independent Test**: Quickstart scenario 7

- [ ] T030 [US5] Flag look-alike team names in a division as R11 defines them, in the shared standings (`packages/shared/src/scoring/`). Covered by new cases in the T017 standings spec: "Calgry 1" flagged against "Calgary 1", "Calgary 1" not flagged against "Calgary 2"
- [ ] T031 [US5] Add Merge to each flagged pair in the portal's standings view: every quiz in that division using the merged name is edited through the T026 quick-form path and saved with action `merged` (R10). Covered by the T026 file-edit spec plus a case for choosing affected quizzes

**Checkpoint**: Quickstart scenario 7 passes

---

## Phase 8: User Story 6 - Team list for the meet (Priority: P3)

**Goal**: Admins enter team names per division; joined scoresheets offer them

**Independent Test**: Quickstart scenario 8

- [ ] T032 [US6] Add the team name table (`meet_team_names`, "Unique on meet, division and folded name") to `packages/api/src/db/schema.ts` via `db:generate` with DDL in `packages/api/src/test-db.ts`, add the table to `docs/data-model.md`, and implement `GET /team-names` and `PUT /team-names` in `packages/api/src/routes/results.ts` per the contract, with route specs in `results.spec.ts`
- [ ] T033 [P] [US6] Add a team-names editor per division to the portal's meet admin area in `apps/web/src/views/`, with its calls in `apps/web/src/api.ts`
- [ ] T034 [P] [US6] Offer the meet's team names for the quiz's division in the scoresheet's team picker, through the team options in `apps/scoresheet/src/composables/useMeetSession.ts`, still accepting typed names. Covered by new cases in the `useMeetSession` spec

**Checkpoint**: Quickstart scenario 8 passes

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Finish the last pull request

- [ ] T035 [P] Move practice meet results to "Available now" in `apps/web/src/views/RoadmapView.vue` and record it in `ROADMAP.md` against #7
- [ ] T036 Release shared, api, scoresheet and web MINOR for Stories 5 and 6, naming the bundled shared version
- [ ] T037 Run every [quickstart.md](./quickstart.md) scenario, including scenario 9 (access)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** and **Foundational (Phase 2)**: first, together, as the first pull request
- **User Story 1**: after Phase 2
- **User Story 2**: after User Story 1 (it counts stored quizzes)
- **User Story 3**: after User Story 1
- **User Story 4**: after User Story 3 (officials in the portal, the shared dialog); its history shows counting records, so after Story 2 as well
- **User Story 5**: after Stories 2 (standings) and 4 (the quick-form edit path)
- **User Story 6**: after User Story 1
- **Polish**: last

### Within Each User Story

- A new test is written, and seen to fail, before the implementation it covers
- An owner from plan.md's "Reuse and Ownership" table before the tasks that call it
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T008 and T009 (route specs and outcome spec) run in parallel
- T017 and T018 (standings specs and counting route specs) run in parallel
- T033 and T034 (portal editor and scoresheet dropdown) run in parallel once T032 is done
- T035 runs alongside T036

---

## Parallel Example: User Story 2

```bash
Task: "Shared specs for the quiz outcome and standings in packages/shared/src/scoring/__tests__/"
Task: "Route specs for PATCH /results/counted in packages/api/src/routes/__tests__/results.spec.ts"
```

---

## Implementation Strategy

### MVP First

1. Phases 1 and 2: the move, reviewed as a pure refactor
2. Phase 3 (Story 1): quizzes reach the meet
3. Phase 4 (Story 2): finalists without hand calculation. Stories 1 and 2 together replace last
   year's paper process
4. **STOP and VALIDATE** with quickstart scenarios 1 to 3

### Incremental Delivery

Then Stories 3 and 4 (backup path and corrections), then 5 and 6 (conveniences), each its own pull
request with its own releases.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Commit after each task or logical group
- Stop at any checkpoint to validate a story on its own
