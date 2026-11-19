---

description: "Task list for meet stats"
---

# Tasks: Meet stats

**Input**: Design documents from `/specs/006-meet-stats/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/stats-api.md, quickstart.md, mockup.html

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the implementation task names the test task or existing test that covers it.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- pnpm monorepo: `packages/shared/src/`, `packages/api/src/`, `apps/web/src/`, `apps/scoresheet/src/`
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

Six pull requests, each opened only with the maintainer's approval:

1. Phases 1 to 3: scored revisions, the stats route and page for admins, quizzer standings (User Story 1)
2. Phases 4 and 5: stages, links and accepting a quiz as scored (User Stories 2 and 3)
3. Phases 6 and 8: what viewers see, division steps, and the stats settings (User Stories 4 and 6)
4. Phase 7: the stats page as it should read and print (User Story 5)
5. Phases 9 and 10: results management, checking a number, the download (User Stories 7 and 8)
6. Phase 11: polish

A document a phase changes is amended in that phase's pull request, never later (principle II); each phase ends with the task that does it.

Each pull request rebases onto master first and carries its own changelog entries and release bumps: shared MINOR in every pull request that changes `packages/shared/src/`, api MINOR, web MINOR, scoresheet MINOR where it changes, each consumer naming its bundled shared version. A table arrives in the pull request of the story that first writes it, through `pnpm --filter @qzr/api db:generate`, never by hand, with its DDL added to `packages/api/src/test-db.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The reference meet as test data, with nobody's real name in it (R14)

- [X] T001 With a script kept outside the repository (beside the reference meet in the maintainer's notes), read the reference meet's 74 scoresheets through `readOds`, replace every team and quizzer name with a made-up one consistently across quizzes, and write the quiz files and the statistician's expected rows (team rows and quizzer rows per quiz, quizzer standings per division with the consolation list apart, prelim standings, the re-ranked order) into `packages/shared/src/scoring/__tests__/fixtures/`, beside the existing `fifteenQuestionQuiz.ts`. Confirm by search that no name from the source appears anywhere in the repository. Record in the fixture's header comment what it is, that names are made up, and the known limits in research R14 (five sheets with slips, the workbook's tie order, consolation team rows absent)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: A stored revision is scored once, and the API serves a division's stats from scored revisions (R1, R2). Every story reads through this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for the foundation

> **NOTE: Where a task adds a new test, write it first and see it fail.**

- [X] T002 [P] Spec for what scoring makes of one stored quiz, in `packages/shared/src/stats/__tests__/`: per team its name, score, errors and place by score; the quiz's scoring errors as `assessQuiz` lists them (each validation error with its team, seat, question and code, and the unanswered questions; R16); per listed quizzer the name, points, errors, correct answers and correct answers by question type, with bonus and overtime answers adding nothing (FR-001, FR-007); the quiz's own formula; and no placement points. Run it over every quiz of the T001 fixtures against the expected quizzer rows (SC-001)
- [X] T003 [P] Spec for a division's stats from scored revisions, in `packages/shared/src/stats/__tests__/`: quizzes grouped by stage with places and scores, prelim standings equal to what `divisionStandings` gives today for the same counted quizzes, placement points worked out when read from each team's place and score, a quiz in error adding nothing and being named
- [X] T004 [P] Route specs in `packages/api/src/routes/__tests__/stats.spec.ts` and `routeMountOrder.spec.ts`, extending the helpers in `packages/api/src/test-utils.ts`: a scored row is written when a revision is saved and a restoring revision uses the row of the revision it restores; `GET /stats` and `GET /stats/:division` answer an admin; a guest token reaches the router; a division with rows missing or scored by another shared version answers 503 with `Retry-After` and a repeat gets further until 200; a non-member is refused

### Implementation for the foundation

- [X] T005 Scoring one stored quiz into its scored facts, owned by shared `stats/` (plan: Reuse and Ownership), in a new module under `packages/shared/src/stats/` exported from `packages/shared/src/index.ts`, reading `deserialize`, the pass `quizOutcome` already makes and `scoreTeam`'s per-quizzer result rather than scoring anything anew (principle III; `quizOutcome` itself returns no quizzer figures, which is why this sits beside it); covered by T002
- [X] T006 A division's stats from its scored revisions, owned by shared `stats/`, with the response types of `contracts/stats-api.md` exported from shared so the API and portal share them: for now the quizzes by stage and the prelim standings, with a quiz's stage taken from its counting record (counted is prelim, R3); covered by T003
- [X] T007 The `quiz_result_scores` table of `data-model.md` ("revision", "shared version", "scored" JSON; "Holds nothing a setting or a later decision can change: no placement points, no stage, no ranking") in `packages/api/src/db/schema.ts` through `db:generate`, with its DDL in `packages/api/src/test-db.ts`; `packages/api/src/routes/results.ts` writes the row where a revision is added (`addRevisions`), keyed by the running `@qzr/shared` version; covered by T004
- [X] T008 A new router `packages/api/src/routes/stats.ts`, mounted in `packages/api/src/index.ts` so guest tokens reach it as they reach the results router, serving `GET /stats` and `GET /stats/:division` to admins only for now: it reads the division's scored rows, scores a few that are missing or stale and answers 503 with `Retry-After: 1` while any remain (R2), and builds the response with T006's function; covered by T004
- [X] T009 A division stats page in `apps/web/src/views/` on a new route under `/:slug` in `apps/web/src/router/index.ts`, with its calls in `apps/web/src/api.ts` following a 503's `Retry-After`: an admin sees the division's quizzes and prelim standings from the API. `apps/web/src/views/ResultsView.vue` stops ranking and links to it, and `countedQuizzes` and its callers leave `apps/web/src/results.ts` and `apps/web/src/__tests__/results.spec.ts` (plan: the portal's own ranking is removed, not kept beside its replacement)
- [X] T010 In the same pull request (principle II): `docs/data-model.md` gains the `quiz_result_scores` table and `docs/architecture.md` says that a division's stats are computed in the API from scored revisions and that the portal no longer ranks

**Checkpoint**: An admin opens a division's stats and sees the same prelim standings as before, now from the API; `pnpm test:unit`, `pnpm type-check` and `pnpm lint` pass

---

## Phase 3: User Story 1 - Quizzer standings (Priority: P1) 🎯 MVP

**Goal**: A division's quizzers ranked by average, with the consolation list apart, as the statistician's report has them

**Independent Test**: Quickstart scenario 5, and the reference-meet specs

### Tests for User Story 1

- [X] T011 [P] [US1] Spec for quizzer standings in `packages/shared/src/scoring/__tests__/`: totals over the quizzes that count for individuals; the average as total points over the quizzes the quizzer's team played (FR-003); ranking by the exact average then fewest errors, level on both sharing a place with the next place skipped (FR-004); a quizzer identified by folded name within folded team within division, the same name on another team being another quizzer (FR-002); a quizzer listed in fewer or more quizzes than their team flagged with both counts and the average unchanged (FR-005); type counts that don't add up to correct answers flagged (FR-007); quizzers of teams that played any consolation quiz listed and ranked apart over every counting quiz their team played (FR-006). Run it against the T001 fixtures' quizzer standings for every division (SC-001)

### Implementation for User Story 1

- [X] T012 [US1] Quizzer standings, owned by a new module in `packages/shared/src/scoring/` (plan: Reuse and Ownership), built from the scored facts of T005 and reusing `foldName` and the most-used-spelling tally `packages/shared/src/scoring/standings.ts` keeps for teams; covered by T011
- [X] T013 [US1] The quizzer table of `contracts/stats-api.md` (`QuizzerTable`: lists with `consolation`, each quizzer's `place`, exact `average`, `points`, `errors`, `jumps`, `quizzes`, `types`, `lines`, and for admins `flags`) added to a division's stats in shared `stats/` and so to `GET /stats/:division`; cases added to the T003 and T004 specs
- [X] T014 [US1] The division stats page in `apps/web/src/views/` shows the quizzer standings with the consolation list apart, averages to two decimals, and for the admin each quizzer's flags
- [X] T015 [US1] In the same pull request: record in `docs/scoring-rules-explained.md`, under "Rules Not in the Rulebook" with what each is based on, the average's divisor (the quizzes the quizzer's team played), ranking averages by fewest errors, and shared places

**Checkpoint**: Quizzer standings for the reference meet match the workbook; an admin reads them in the portal

---

## Phase 4: User Story 2 - Each quiz counts for the right tables (Priority: P1)

**Goal**: Every stored quiz has a stage, taken from the scheduled quiz it is linked to or set by the admin; each table uses the right stages

**Independent Test**: Quickstart scenarios 1, 2, 3 and 10, and the roster errors of scenario 13

### Tests for User Story 2

- [X] T016 [P] [US2] Spec in `packages/shared/src/stats/__tests__/` for a scheduled quiz's stage (`phase: 'prelim'` is a prelim; an elim with `line` an intermediate; an elim with `deciding` a Finals; any other elim an elimination, R3), for a stored quiz's stage in the order of `data-model.md` ("the newest `stage` row; else the stage of the linked scheduled quiz; else, with no link, prelim when the newest counting record says counted; else not counted"), and for whether a quiz file matches a scheduled quiz: name by `resultKey` against `resultName`, team names against the teams the schedule gives where it gives them, compared ignoring case, spacing and punctuation, a miss by a slightly different team name reported as a near miss, a quiz whose schedule names no teams matched on its name alone (R4), for an elimination or Finals that ends level with no overtime being `tieLeftStanding` while a level prelim or intermediate is not (FR-014), and a division or quiz number that is blank or `_` being none, so the quiz matches nothing and has no stage
- [X] T017 [P] [US2] Spec in `packages/shared/src/stats/__tests__/` for a quiz's roster errors against its division's teams and rosters (R12, R16): a team matched by full name or short name ignoring case, spacing and punctuation, and a quizzer by folded name, raise nothing; a name that matches nothing, a blank team name, a team of another division and an older sheet's "Team 1" or "Quizzer 1" included, is an error naming the nearest roster name; a team listing more quizzers than its roster has; a roster quizzer missing from the quiz; a seat with no name and no answers is nobody; a meet with no roster raises none (FR-002a)
- [X] T018 [P] [US2] Spec cases in `packages/shared/src/scoring/__tests__/standings.spec.ts` and the T003 spec: prelim standings over prelims only; finalists marked only where the division has no intermediate or elimination quiz scheduled or stored (FR-011); the re-ranked order of an intermediate's teams by confirmed prelim placement points plus the intermediate's, checked against the T001 fixtures' re-rank (FR-012, SC-002); a Finals giving its bracket's first three and adding nothing to standings or to any quizzer (FR-013); two Finals for one bracket, or a Finals level or incomplete, giving no medallists and a warning; quizzer standings leaving out Finals
- [X] T019 [P] [US2] Route specs in `packages/api/src/routes/__tests__/results.spec.ts`: a submission carrying `scheduleQuizId` arrives linked as sent by the scoresheet, takes the scheduled quiz's stage and counts with no admin action; one without it links itself when name and team names match and stays unlinked otherwise, with a near miss returned as `suggestedLink`; a revision that changes the name or a team name runs the match again; `scheduleQuizId` not in the meet's published schedule is 400; a scheduled quiz already linked to another stored quiz leaves the submission stored and unlinked; `PUT /results/:id/link` by an admin and by the quiz's room official, 409 naming the other quiz; a linked quiz whose name or teams differ from the scheduled quiz's is in error and does not count; in a meet with rosters a quiz with a roster error is in error and does not count, each error on `problems`, and correcting the roster clears it with no new revision; a team written by its short name in one quiz and its full name in another is one row under the roster's full name in a division's stats (cases added to the T003 spec); `problems` lists every scoring error with its team, seat, question and code; `PATCH /results/stage` for several ids at once, `null` returning a quiz to its link's stage, 404 changing nothing for a foreign id; quizzes counted before this feature are prelims; the history lists each change; every write refused by phase as the results routes are today; an elimination or Finals left level with no overtime carries `tieLeftStanding`, and one still level in an unfinished overtime `undecided`, on `problems`, and neither counts

### Implementation for User Story 2

- [X] T020 [US2] A scheduled quiz's stage, a stored quiz's stage, the match between a quiz file and a scheduled quiz, and whether an elimination or Finals was left level, each owned by shared `stats/`, (plan: Reuse and Ownership) and reusing `resultKey`, `resultName`, `scheduleQuizMeta`, `teamDisplayName` and `editDistance`; covered by T016
- [X] T021 [US2] A quiz's roster errors, one function owned by shared `stats/` (plan: Reuse and Ownership), with the team name comparison moved there from `teamNamed` and `looseName` in `apps/scoresheet/src/composables/useMeetSession.ts`, which then calls the shared one with its own specs in `apps/scoresheet/src/composables/__tests__/useMeetSession.spec.ts` still passing, so the sheet and the server match alike (FR-014a; tell the scoresheet session before editing that file); covered by T017. The scoresheet half (calling the shared comparison from `useMeetSession.ts`) waits for the scoresheet session's `feat/open-new-link` (specs/007-open-new-link) to merge, which reworks that file while leaving these functions as they are; the shared function and its API callers do not wait
- [X] T022 [US2] The `quiz_result_changes` table of `data-model.md` (append-only; `kind` one of "`stage`, `link`, `acceptance` or `kept`"; `stage` one of "prelim, intermediate, elimination, finals, or not counted"; `how` one of "sent by the scoresheet, matched on arrival, or by hand") in `packages/api/src/db/schema.ts` through `db:generate`, with its DDL in `packages/api/src/test-db.ts`, and in `packages/api/src/routes/results.ts` one helper that writes a change row and one that reads a quiz's current value of each kind; `PATCH /results/stage` replaces `PATCH /results/counted`, whose route and portal caller are removed while `quiz_result_count_changes` stays read-only (R3); `GET /results` gains `stage` and `stageFrom`; `GET /results/:id/revisions` gains the `change` entries; covered by T019
- [X] T023 [US2] Linking in `packages/api/src/routes/results.ts`, where a revision is added: `POST /results` takes `scheduleQuizId`, an unlinked quiz is matched against the newest published schedule (`newestVersion` in `packages/api/src/routes/schedule.ts`) on arrival and after a revision changes its name or a team name, `PUT /results/:id/link` links, relinks or unlinks by hand, and `GET /results` gains `link`, `suggestedLink` and the scoring, roster and schedule problems of `QuizProblem`, roster and schedule errors worked out when read from the division's teams and rosters and the newest published schedule (R16), a division's stats keying a matched team by its roster team and showing the roster's full name, `problems` being null for a quiz whose current revision is still to be scored so the list never waits (R2); "at most one stored quiz of a meet should be linked to a scheduled quiz; a second is refused, naming the first"; covered by T019
- [X] T024 [US2] A division's stats use stages, in shared `stats/` and `packages/shared/src/scoring/standings.ts`: the re-rank beside the standings, finalists marked on request, the Finals' first three as `medals`, the Finals left out of quizzer standings, the two-Finals and undecided-Finals warnings; the stats route passes each quiz's stage and link; covered by T018. With every quiz now placed before it reaches the standings, `divisionStandings` loses the `unplaced` warning and the `placed` flag of `CountedQuiz`, which nothing can raise any more
- [X] T025 [US2] `apps/web/src/views/ResultsView.vue` shows each quiz's stage and link in place of the counted toggle: set a stage for one quiz or for the quizzes shown together, link by hand to a scheduled quiz, take a suggested link, and see a linked quiz whose name or teams differ as in error; the division stats page shows the re-rank and the Finals' first three; calls in `apps/web/src/api.ts`
- [X] T026 [P] [US2] The scoresheet sends `scheduleQuizId` with a submission when the meet session has a `quizId` and nothing when it has none, in `apps/scoresheet/src/api.ts` (`submitResult`) and `apps/scoresheet/src/composables/useSubmitToMeet.ts`; the quiz file is unchanged (R4, R15); covered by cases added to `apps/scoresheet/src/composables/__tests__/useSubmitToMeet.spec.ts`. Built on `feat/open-new-link` (#175): the meet session's `quizId` is the linked scheduled quiz, and is sent only to the meet the sheet is linked to

**Checkpoint**: A quiz submitted from the schedule counts with nothing for the admin to do; standings, re-rank, medals and averages each use the right quizzes

---

## Phase 5: User Story 3 - Accept a quiz that has errors (Priority: P1)

**Goal**: A quiz in error is left out and named; an admin can accept it as scored, and it then counts, marked

**Independent Test**: Quickstart scenario 4

### Tests for User Story 3

- [X] T027 [P] [US3] Spec cases in the T003 spec and in `packages/api/src/routes/__tests__/results.spec.ts`: a quiz in error with a stage, whichever of the three kinds its errors are, adds nothing to any table and is named with what is wrong; accepted, its teams are placed by their scores as they stand with the meet's formula giving the placement points, and it counts in every table its stage calls for, marked accepted; withdrawing drops it out; an acceptance applies to the revision accepted, a later revision in error needing its own and one without errors needing none, a revision restoring accepted content being accepted, and an accepted quiz staying accepted when a later change to the roster gives its revision a new roster error (FR-016, R6); `PUT /results/:id/acceptance` is for admins, 409 when accepting a revision that is not the current one; the history lists both actions

### Implementation for User Story 3

- [X] T028 [US3] Acceptance through the change helper of T022 in `packages/api/src/routes/results.ts`: `PUT /results/:id/acceptance`, `problems` and `accepted` on `GET /results`, and a division's stats in shared `stats/` counting a quiz in error only while its current content is that of an accepted revision, placing it by its scores (plan: placing a quiz accepted as scored), an acceptance covering every kind of error; covered by T027
- [X] T029 [US3] `apps/web/src/views/ResultsView.vue` and `apps/web/src/views/ResultView.vue` list every problem of a quiz in error under its kind (scoring errors with team, seat, question and the message `validationMessage` gives; roster errors with the nearest roster name and the fix of taking it; schedule errors) and let an admin accept it as scored or withdraw that, one quiz or the quizzes shown together; the division stats page marks an accepted quiz "accepted as scored"
- [X] T030 [US3] In the pull request of Phases 4 and 5: `docs/data-model.md` gains the `quiz_result_changes` table and says `quiz_result_count_changes` is now read-only; `docs/roles-and-access.md` gains linking by a quiz's room official and accepting by admins; `docs/architecture.md` gains the three kinds of quiz problem and where each is found; `docs/meet-link.md` says that a submission from a sheet holding a scheduled quiz carries that quiz's id, while picks are still never sent, and that the server finds roster and schedule errors again from names with the same shared comparison, as errors where the sheet shows warnings; `specs/003-practice-meet-results/spec.md` is amended where these phases replace it (the counted toggle of FR-013, finalists on every division in FR-012), the code being authoritative

**Checkpoint**: The reference meet's five sheets with slips can be accepted and its standings then match the workbook

---

## Phase 6: User Story 4 - Who sees what, and when (Priority: P2)

**Goal**: Viewers are shown each thing from the moment the admin's settings give it, as the admin confirms each division's steps; standings always say which state they are in

**Independent Test**: Quickstart scenarios 6, 7, 8 and 14

### Tests for User Story 4

- [X] T031 [P] [US4] Spec in `packages/shared/src/stats/__tests__/` for the settings document (the defaults of FR-018b; a stage's results set to start before the stage refused) and for what a viewer has: for every thing, every moment, every division state and every meet phase, whether a viewer gets it and at which level, and for standings which state they are in ("live preview", "preview", "locked in" as FR-020 defines them, quizzer standings locked in only once the meet is done); nothing outside `live`, `review` and `done`; quizzer standings by stage covering the quizzes up to the last confirmed step; the setting for prelims played without overtime, on by default (FR-023d)
- [X] T032 [P] [US4] Route specs in `packages/api/src/routes/__tests__/stats.spec.ts`: `GET /stats/settings` for any member and `PUT /stats/settings` for admins, an invalid document 400, 409 once the meet is done, each save kept with who and when; `GET /stats` for any member, its divisions with no tables for anyone but an admin while the meet is in `registration` or `build`; `GET /stats/:division` for a viewer, a coach and an official carries each thing only from its moment and results only at the level set, never a full scoresheet, never a quiz that is not counted, a quiz in error and not accepted as under review with team names only, no warnings; an official also gets the problems of quizzes of their own rooms, of all three kinds, and whether a quiz's question types are incomplete (FR-020a), and not of other rooms'; nothing for anyone but an admin in `registration` or `build` (SC-005)
- [X] T033 [P] [US4] Route specs in `packages/api/src/routes/__tests__/phase.spec.ts`: `finals` is a step between `elim_running` and `division_done`; `GET /divisions/state` reports `ready`, `missing` and `confirmed`; moving on with scheduled quizzes missing or not counting is 409 with `missing` unless `confirm`; moving to `stats_break` records the prelim order and to `elim_running` the re-rank where the division has intermediates; moving back with no later quiz stored withdraws freely, and with later quizzes stored is 409 with `affected` unless `confirm`, after which those quizzes are flagged until `POST /results/:id/keep` or a stage of not counted; a later change to a prelim leaves the confirmed order as it was and reports the current one beside it for admins

### Implementation for User Story 4

- [X] T034 [US4] The stats settings schema with its defaults, the moments as `data-model.md` maps them to division states and meet phases, and what a viewer has with the state of standings, owned by shared `stats/` (plan: Reuse and Ownership, R10, R11), and `finals` added to `DIVISION_STATES` in `packages/shared/src/phases.ts` with every consumer of that list in `apps/` and `packages/` checked; covered by T031; the schema carries whether prelims are played without overtime, on by default (FR-023d)
- [X] T035 [US4] The `meet_stats_settings` table of `data-model.md` (append-only; "the newest is the meet's settings, and a meet with no row has the defaults") in `packages/api/src/db/schema.ts` through `db:generate`, with its DDL in `packages/api/src/test-db.ts`, and `GET /stats/settings` and `PUT /stats/settings` in `packages/api/src/routes/stats.ts`; covered by T032
- [X] T036 [US4] `packages/api/src/routes/stats.ts` answers every member on `GET /stats` and `GET /stats/:division`, the settings routes registered before `:division`, cutting a division's stats to what the caller may see with T034's function before the response is built (plan: cutting a response to its caller), using `isViewerOf`, `isAdminOrSuperuser` and `officialRoomsOf`; covered by T032
- [X] T037 [US4] The `division_confirmations` table of `data-model.md` (append-only; `what` "the prelim order, or the re-rank"; `action` "confirmed, or withdrawn") in `packages/api/src/db/schema.ts` through `db:generate`, with its DDL in `packages/api/src/test-db.ts`; the existing state route in `packages/api/src/routes/phase.ts` takes the division in its path as the meet spells it (`findDivision`), for its state row and its confirmations alike, and gains `finals`, readiness, the confirmations and withdrawals and their two 409s; `POST /results/:id/keep` through the change helper of T022; a division's stats carry the confirmed order with, for admins, the current one when it differs (FR-019a to FR-019c); covered by T033
- [X] T038 [US4] The stats settings page in `apps/web/src/views/` on a new route, laid out as the Sentences layout of `specs/006-meet-stats/mockup.html` (FR-023c): each division's steps with its readiness and the control to confirm the next or take the last back, both warnings shown in the page and not as browser dialogs, "Start Finals" making both moves for a division with no eliminations, and the offer to move the meet to review when the last division is marked done (FR-019d); one line for each thing offering only the choices that make sense, with what each division's viewers have of it right now; saved, not instant, after stating what viewers will newly see and stop seeing, worked out in `apps/web/src/stats.ts` from T034's function and covered by a spec in `apps/web/src/__tests__/`; a look at a division's page as a viewer
- [X] T039 [US4] The division stats page serves every member reaching the meet with its viewer code, signed in or as a guest (`apps/web/src/meetAccess.ts`, `apps/web/src/router/index.ts`): standings marked live preview, preview or locked in in those words, a thing not yet available saying so, a quiz under review listed without places, results at the level the settings give
- [X] T040 [US4] In the same pull request: `docs/roles-and-access.md` (what viewers, coaches and officials see of results and standings by phase and division state; standings no longer admin-only), `docs/scheduling.md` (the `finals` division state, what each move confirms, and that taking one back withdraws it), `docs/data-model.md` (the `meet_stats_settings` and `division_confirmations` tables), and `specs/003-practice-meet-results/spec.md` where it says standings are for admins only

**Checkpoint**: A viewer following a division through its day sees each thing appear at its moment and never before

---

## Phase 7: User Story 5 - A stats page worth reading (Priority: P2)

**Goal**: One page per division that reads well on a phone and on a projector and prints as the statistician's report

**Independent Test**: Quickstart scenario 11

### Implementation for User Story 5

- [X] T041 [US5] The division stats page in `apps/web/src/views/` laid out for reading (FR-024, FR-025): the Finals' first three, prelim standings with any re-rank, quizzer standings with the consolation list apart, the division's quizzes by stage; each table's place, name and ranking figure fitting a phone's width with no sideways scrolling, the rest of a wide table scrolling inside its own container; the page reading well when a table is absent
- [X] T042 [US5] Print styles for the same page: one division to a sheet with places, teams, quizzers, averages, errors and jumps and the number of quizzers in the division, no controls or navigation, and quizzers with no jumps left off the printed list while still counted in that number and in the places (FR-026); on screen every quizzer is listed
- [X] T043 [US5] In the same pull request: record in `docs/scoring-rules-explained.md`, under "Rules Not in the Rulebook", that quizzers with no jumps are left off the printed list and still counted

**Checkpoint**: A printed division page can be handed out in place of the statistician's report (SC-004)

---

## Phase 8: User Story 6 - Stats settings for the meet (Priority: P2)

**Goal**: The meet chooses its tie-break order and how teams level in a quiz are scored

**Independent Test**: Quickstart scenario 9

### Tests for User Story 6

- [X] T044 [P] [US6] Spec cases in `packages/shared/src/scoring/__tests__/standings.spec.ts` and the T003 spec: with the order "total points, then fewest errors" head-to-head is not used in standings or the re-rank and each broken tie names the criterion that decided it, checked against the T001 fixtures' prelim ranks for the division whose tie the workbook broke by errors (SC-002); the rulebook order is the default; a quiz that ended level scores its level teams the meet's way whatever the quiz file carries, switching back restores the points, and no scored row changes (FR-023a); with the meet's prelims played without overtime, overtime played in a prelim or an intermediate is `overtimePlayed` and the quiz adds nothing, a prelim with overtime switched on but never played is not, and with the setting off neither is (FR-014, FR-023d), `scoreStoredQuiz` keeping whether overtime was played with a case added to its spec
- [X] T045 [P] [US6] Route specs in `packages/api/src/routes/__tests__/results.spec.ts` and `stats.spec.ts`: a stored quiz whose own formula differs from the meet's carries `otherFormula` and still counts; `POST /results/formula` gives each such quiz one new `edited` revision in the meet's formula, keeps its acceptance, and reports how many changed; a setting changed after an order was confirmed leaves the confirmed order as it was

### Implementation for User Story 6

- [X] T046 [US6] `divisionStandings` and the re-rank in `packages/shared/src/scoring/standings.ts` take the meet's tie-break order, and a division's stats in shared `stats/` work out placement points with the meet's formula in place of the file's, through `computePlacementPoints`; covered by T044. `scoreStoredQuiz` keeps whether overtime was played, and a quiz's stage problems in shared `stats/` gain `overtimePlayed` under the meet's setting (plan: Reuse and Ownership, R16); the stats settings page gains the setting beside the other two
- [X] T047 [US6] `otherFormula` on `GET /results` and `POST /results/formula` in `packages/api/src/routes/results.ts` (plan: setting quizzes to the meet's formula, as ordinary `edited` revisions through `addRevisions`); the scoring section of the stats settings page in `apps/web/src/views/`, with the note on quizzes scored the other way and the one action that sets them to match; covered by T045
- [X] T048 [P] [US6] A scoresheet working with a meet, linked to it or loading a quiz from it, takes the meet's way of scoring level teams as its quiz's `placementFormula`, read from `GET /stats/settings`, in `apps/scoresheet/src/composables/useMeetSession.ts` and `apps/scoresheet/src/api.ts`; a sheet that cannot reach the API keeps its own setting (principle I); covered by cases added to `apps/scoresheet/src/composables/__tests__/useMeetSession.spec.ts`
- [X] T049 [US6] In the same pull request: record in `docs/scoring-rules-explained.md` the second tie-break order as an opt-in meet setting with the rulebook order the default (principle II), and that the meet's setting decides how teams level in a quiz are scored; `docs/meet-link.md` says that a sheet working with a meet takes that setting; amend `specs/003-practice-meet-results/spec.md` where it says a quiz's placement points are those the quiz itself scores (FR-010 and its assumption); and record there, under "Rules Not in the Rulebook", that a meet may play its prelims and intermediates without overtime, a tie standing: a meet setting, on by default, being how these meets have long read a rule the rulebook leaves ambiguous (Types of Quizzes 1.d sends a tie to overtime, Scoring 1.e.iv gives a tie placement points by the score at question 20)

**Checkpoint**: The reference meet, set to its own tie-break order, ranks as the workbook and its seeding did

---

## Phase 9: User Story 7 - Results that are easy to keep in order (Priority: P3)

**Goal**: Results management is its own page that names everything needing attention and leads to the fix

**Independent Test**: Quickstart scenario 3, and the merging and look-alike steps of scenario 13

### Tests for User Story 7

- [X] T050 [P] [US7] Route specs in `packages/api/src/routes/__tests__/stats.spec.ts`: `GET /stats/attention` is for admins, is built from each division's stats under one scoring budget for the request, answers 503 with `Retry-After` while revisions are still to be scored as a division's stats does, and lists every `AttentionItem` kind of `contracts/stats-api.md` when its condition holds and not otherwise; roster errors appear under `inError` with the quiz's other problems and there is no separate roster kind; two quizzer names on one team that look alike are flagged; `POST /stats/dismissals` is idempotent and a dismissed pair of team or quizzer names is not flagged again (FR-032)

### Implementation for User Story 7

- [X] T051 [US7] What needs attention, collected across divisions by `packages/api/src/routes/stats.ts` from the warnings a division's stats already give (plan: Reuse and Ownership): roster errors come from the quizzes in error, already found in Phase 4; look-alike quizzer names on a team by the test `packages/shared/src/scoring/standings.ts` uses for teams; the `meet_name_dismissals` table of `data-model.md` ("unique per meet, division, team and pair"; names "folded, in a fixed order") in `packages/api/src/db/schema.ts` through `db:generate` with its DDL in `packages/api/src/test-db.ts`, and `POST /stats/dismissals`; covered by T050
- [X] T052 [US7] `apps/web/src/views/ResultsView.vue` becomes results management (FR-029 to FR-032): the list narrowed by division, stage and whether a quiz needs attention; the list of what needs attention, each item saying what is wrong and leading to the action that fixes it; merging one quizzer name into another across a team's quizzes through `editQuizFile` and `mergeEdits` in `apps/web/src/results.ts`, as team names are merged; dismissing a look-alike flag; every action the page has today kept
- [X] T053 [US7] In the same pull request: `docs/data-model.md` gains the `meet_name_dismissals` table, `docs/roles-and-access.md` the results management actions

**Checkpoint**: Everything that keeps a stored quiz out of the tables is named in one list and can be cleared from there (SC-007)

---

## Phase 10: User Story 8 - Check any number (Priority: P3)

**Goal**: Any total can be traced to the quizzes behind it, and the admin can take the tables away as files

**Independent Test**: Quickstart scenario 12

### Implementation for User Story 8

- [X] T054 [US8] On the division stats page in `apps/web/src/views/`, anyone who may see a table can open a team or a quizzer in it and see the quizzes behind their totals from the `lines` the response carries, which a viewer's cut now passes through with a quiz's score only where that stage's results show scores: for a quizzer, points, errors, jumps and correct answers by type per quiz; for a team, stage, place, score, placement points and errors per quiz (FR-027, SC-006)
- [X] T055 [US8] An admin downloads a division's stats as three CSV files made in the browser from the admin's stats response, in `apps/web/src/stats.ts`: a row per team per quiz, a row per quizzer per quiz, and the standings, in the workbook's column order (R13, FR-028); covered by a spec in `apps/web/src/__tests__/` on the rows and their escaping

**Checkpoint**: A doubted number is traced in two steps; the statistician can compare with their workbook

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: The roadmap, and proof on the deployed plan

- [ ] T056 Move stats from planned to available in `ROADMAP.md` and `apps/web/src/views/RoadmapView.vue` once the last story ships, and note on issue #8 what shipped, with the maintainer's leave
- [ ] T057 Run every scenario of `specs/006-meet-stats/quickstart.md`, and measure on the deployed free-plan Worker, for the reference meet, the CPU time and the number of database queries of `GET /stats/:division` for its largest division, of `GET /stats/attention` and of `GET /results`; record the numbers in `specs/006-meet-stats/research.md` (R2) and adjust how many revisions a request scores if any is near 10 ms or 50 queries

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs the fixtures of Phase 1; blocks every story
- **User Story 1 (Phase 3)**: needs Phase 2
- **User Story 2 (Phase 4)**: needs Phase 2; its Finals handling refines User Story 1's averages. Its two scoresheet changes (T026, and the scoresheet half of T021) wait for the scoresheet session's `feat/open-new-link` to merge; everything else in the phase does not
- **User Story 3 (Phase 5)**: needs the change log of User Story 2 (T022)
- **User Story 4 (Phase 6)**: needs User Stories 2 and 3 (stages, links and acceptance decide what counts and what is under review)
- **User Story 5 (Phase 7)**: needs User Stories 1 and 2 for something to lay out; reads better after User Story 4
- **User Story 6 (Phase 8)**: its tie-break and formula need Phase 2; its settings page section needs User Story 4 (T035, T038)
- **User Story 7 (Phase 9)**: needs User Stories 2 and 3
- **User Story 8 (Phase 10)**: needs User Story 1; open to viewers after User Story 4
- **Polish (Phase 11)**: after the last story

The stories are not independent of one another: this feature builds one page from several decisions, and the order above is the order in which each has something to stand on.

### Within Each User Story

- A new test is written, and seen to fail, before the implementation it covers
- An owner from plan.md's "Reuse and Ownership" table before the tasks that call it
- Shared before the API, the API before the portal
- Story complete before moving to the next

### Parallel Opportunities

- T002, T003 and T004 (three spec files)
- T016, T017, T018 and T019 (four spec files); T026 (scoresheet) beside the rest of User Story 2
- T031, T032 and T033 (three spec files)
- T044 and T045; T048 (scoresheet) beside the rest of User Story 6

---

## Parallel Example: User Story 2

```bash
# The specs for User Story 2 touch different files:
Task: "Spec for a scheduled quiz's stage, a stored quiz's stage and the match, in packages/shared/src/stats/__tests__/"
Task: "Spec cases for prelims-only standings, finalists, the re-rank and Finals in packages/shared/src/scoring/__tests__/standings.spec.ts"
Task: "Route specs for linking and stages in packages/api/src/routes/__tests__/results.spec.ts"

# The scoresheet change touches no file the others do:
Task: "Send scheduleQuizId with a submission in apps/scoresheet/src/api.ts and useSubmitToMeet.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: the fixtures
2. Phase 2: scored revisions, the stats route, the page for admins
3. Phase 3: quizzer standings
4. **STOP and VALIDATE**: the reference-meet specs pass; an admin reads a division's quizzer standings
5. First pull request, with the maintainer's approval

### Incremental Delivery

1. Pull request 1 gives the admin quizzer standings: what the portal lacked entirely
2. Pull request 2 makes them right for a whole meet: stages, links, and quizzes with slips accepted
3. Pull request 3 opens them to viewers under the admin's settings
4. Pull requests 4 and 5 make the page worth reading and the results easy to keep in order
5. Each pull request leaves the portal working and released

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Verify tests fail before implementing
- Commit after each task or logical group
- No real name from the reference meet in any file, commit or issue
- `tasks.md` is excluded from dprint: keep `- [ ]` and `- [X]` as they are

---

## Phase 12: Convergence

- [X] T058 Bring `specs/006-meet-stats/contracts/stats-api.md` up to the code: `QuizResult.teams` gains admin-only `placementPoints` and `errors`; a team line's `score` is optional; viewers get team lines for stages whose results they see, with `score` only at `scores`, and quizzer lines only where the quiz's stage shows scores; `GET /stats/attention` answers `{ items: AttentionItem[] }`; `POST /stats/dismissals` answers 400 for a missing or repeated name per plan: contracts/stats-api.md (partial)
- [X] T059 Refuse `POST /stats/dismissals` with 409 and `meetPhase` outside `live` and `review` in `packages/api/src/routes/stats.ts`, as the contract's write rule and `docs/roles-and-access.md` say, with a spec in `packages/api/src/routes/__tests__/stats.spec.ts` per contracts/stats-api.md (contradicts)
- [X] T060 Make an attention item's "Show" in `apps/web/src/views/ResultsView.vue` clear any division, stage or attention filter that hides the quiz before jumping to its row per FR-030 (partial)
- [X] T061 Make the `quizzerCount` and `unequalPrelims` items in `apps/web/src/views/ResultsView.vue` show that division's quizzes in the list, where their fix is, rather than only linking to the division's stats per FR-030 (partial)
