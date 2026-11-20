---

description: "Task list for the meet day page"
---

# Tasks: Meet day: one page, in tabs

**Input**: Design documents from `/specs/010-meet-day/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/meet-day-api.md, quickstart.md

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the implementation task names the test task or existing test that covers it.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

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

Four pull requests (plan.md, Delivery), each leaving the portal working and released:

| PR | Tasks | Packages |
| -- | ----- | -------- |
| 1. Benches and the day response | T001 to T006 | shared MINOR, api MINOR |
| 2. The page and its tabs | T007 to T021, T026 to T031 | web MINOR, ui (bundled) |
| 3. Scoresheet benches | T025 | scoresheet MINOR |
| 4. Phone | T022 to T024 | web PATCH |

PR 2 starts once #200 (portal and scoresheet papercuts) is merged and this branch is rebased on it.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Nothing to scaffold: the monorepo, its packages and test setups exist. PR 2's work waits
on #200 (T007).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Which team is on a bench, and the one response the Schedule and Quizzes tabs read
(PR 1); then the page and its tab bar every story builds on (PR 2).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Benches and the day response (PR 1)

- [X] T001 [P] Spec for the bench resolver in `packages/shared/src/schedule/__tests__/resolve.spec.ts`: every bench kind of data-model.md's table settles exactly when it says ("`rank n` — the division's prelim order is confirmed", "`new n` — the division's re-rank is confirmed", "`place {quiz, p}` — quiz `quiz` counts (its teams check aside)", "`points {p}` — every quiz of the holding quiz's lane round robin counts", "`empty` — never"); a bench is never settled from live standings; a withdrawn order unsettles its benches and the benches fed by quizzes filled from it; teams tied across a bench's place mark it tied; names come back as the roster spells them. Extend the elims fixtures in `packages/shared/src/schedule/__tests__/` for the schedules
- [X] T002 The bench resolver, owned by the new `packages/shared/src/schedule/resolve.ts` (plan.md, Reuse and Ownership: "Which team sits on a bench"), reusing the draw, the re-rank's rank numbering (`rerankOf`) and `foldName`; three inline draw lookups (`quizProblems.ts` scheduled teams, `apps/scoresheet/src/api.ts` scheduled quiz, `packages/ui/src/ScheduleSeat.vue` absent check) go through it, behaviour unchanged for letters; these scoresheet and `packages/ui` edits change nothing users see and reach them with PR 3's scoresheet release and PR 2's web release; covered by T001 and the existing quiz problems and scoresheet specs
- [X] T003 [P] Spec for the teams check of an elimination quiz in `packages/shared/src/stats/__tests__/quizProblems.spec.ts`: a stored elimination or Finals quiz whose benches are settled is in error with `teamsDiffer` when its teams aren't the settled ones, and is checked by name only while any bench is unsettled, as today
- [X] T004 The teams check uses settled benches: `scheduledQuizOf` in `packages/shared/src/stats/quizProblems.ts` takes the resolved benches, and `packages/api/src/lib/divisionStats.ts` / `quizFacts.ts` resolve them from the confirmed orders (keyed by the schedule's division ids, research R3) and the places of the division's quizzes that count on everything but their own teams check (research R4); covered by T003 and the existing quiz problems and stats route specs
- [ ] T005 [P] Route spec for `GET /api/meets/:id/day` in `packages/api/src/routes/__tests__/day.spec.ts`, extending the stats route spec's meet and quiz fixtures: the response of contracts/meet-day-api.md for an admin, an official (their room's `storedId` and `problems` only), a viewer and a guest; each status of data-model.md ("`notIn` — no stored quiz is linked to it, or for anyone but an admin and its room's official, the one linked is set not to count", "`hidden` — its stage's results aren't shown to this reader yet, whether a quiz is in or not", "`played`", "`attention`", "`underReview`"); a viewer gets exactly what that viewer's division stats would give (spec FR-024): nothing in registration and build, a hidden stage's quizzes `hidden` whether in or not, under review with team names alone, scores only at the scores level, never a quiz set not to count; an official gets their own room's quizzes with status and problems whatever the stage; teams named as the stored quiz names them, in its order; benches left out until the reader may see their source; `notOnSchedule` for everyone, cut the same way (with no published schedule, every stored quiz), and `attention` for admins only; 503 with `Retry-After: 1` while revisions are scored, never cached; a viewer's copy served from cache, an admin's never; 401 and 403
- [ ] T006 `GET /api/meets/:id/day`, owned by the new `packages/api/src/routes/day.ts` mounted where guest tokens reach it as the stats routes are, building every division under one scoring budget as the attention route does (`statsGround`, `divisionOf`, `REVISIONS_SCORED_PER_REQUEST`), cutting through the same cut a division's stats make (`viewerHas`, `cutTo`; plan.md: "What a reader may see"), not a second set of rules, and caching a viewer's and coach's copy for 20 seconds (research R2); the response types and a scheduled quiz's status in the new `packages/shared/src/stats/meetDay.ts` (plan.md: "A scheduled quiz's status on the page"); `getMeetDay` in `apps/web/src/api.ts` through `whenPrepared`; shared and api release commits last (shared MINOR with a dated CHANGELOG entry, api MINOR); covered by T005

### The page and its tab bar (PR 2)

- [ ] T007 Rebase on master once #200 is merged; re-read the files it changed (`router/index.ts`, `QuizMeetView.vue`, `ScheduleView.vue`, `ResultsView.vue`, `ResultView.vue`, `DivisionStatsView.vue`, `StatsSettingsView.vue`) before moving them
- [ ] T008 The meet page shell: one `/:slug` route with the tab in the path (`quizzes`, `standings`, `roster`, `setup`; none for Schedule) and the division in `?division=`, in `apps/web/src/router/index.ts` and a new `apps/web/src/views/MeetView.vue` holding the meet's header with uploading quiz files for those allowed to send quizzes (FR-007, moved from `ResultsView.vue`), a tab bar of router links (the builder's `.seg` look, research R5), the division picker and Refresh; guests (meet id as slug) reach Schedule, Quizzes and Standings and are sent to Schedule from Roster and Setup; the page always opens on Schedule (FR-001); covered by T009
- [ ] T009 [P] Spec in `apps/web/src/__tests__/` for the page's routes: each tab's path, `?division=` kept across tabs, every old address of contracts/meet-day-api.md's table redirecting (`/stats/settings` matched before `/stats/:division`), guests kept to the three tabs
- [ ] T010 Keeping the page current, owned by a new `apps/web/src/composables/useMeetDay.ts` (plan.md: "Re-reading while open"): reads the day response on switching tabs, when the browser tab comes back into view, on Refresh, and every 30 seconds while the browser tab is visible, never while hidden (FR-022), re-reading the published schedule when the day response names a newer version, and giving the open tab the same beat to re-read its own data, so every tab refreshes together and none keeps its own timer; covered by a spec beside the other composables' specs using fake timers and `visibilityState`
- [ ] T011 Roster and Setup tabs (FR-006): `apps/web/src/views/meet/RosterTab.vue` takes the churches section of `QuizMeetView.vue`, and `apps/web/src/views/meet/SetupTab.vue` takes the rest (details and phase, admin code, rooms and codes, members) with `StatsSettingsView.vue`'s settings as a section, the team names section not brought back (#186); both with the same visibility and controls as today; covered by the existing meet page specs, moved

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Follow the day on the schedule (Priority: P1) 🎯 MVP

**Goal**: The published schedule fills in as quizzes are played, for every reader as far as the settings allow.

**Independent Test**: Quickstart scenarios 1 and 2.

### Tests for User Story 1

- [ ] T012 [P] [US1] Spec in `packages/ui/src/__tests__/` for the schedule's marks: a played quiz shows each team's place and, where given, score beside the bench holding that team, matched by folded name, a team it can't bench listed under the quiz; a quiz needing attention or under review is marked so with its few words; a `hidden` quiz shows "result not shown yet"; a settled bench shows its team on the team line beside its source; with no marks the sheet renders as today (the builder's case)

### Implementation for User Story 1

- [ ] T013 [US1] Results on the schedule, owned by `ScheduleSheet` and `ScheduleSeat` in `packages/ui/src/` (plan.md: "Drawing the schedule with results"): an optional marks input per schedule quiz (status, its teams' results placed by name, settled benches), the sheet's layout unchanged (FR-008 to FR-011); covered by T012
- [ ] T014 [US1] The Schedule tab, `apps/web/src/views/meet/ScheduleTab.vue` from `ScheduleView.vue`: the published schedule with the day response's marks for the picked division or every division, quiz titles opening the stored quiz's page or, for its room's official and admins, the scoresheet in a new tab on desktop (#200's `scoresheetLink`) (FR-012), "the schedule hasn't been published" when none is (FR-007's edge case), the schedule's Edit link for admins; covered by T012 and quickstart scenario 1

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Every quiz and what to fix, in one list (Priority: P1)

**Goal**: The results page becomes the Quizzes tab, with scheduled quizzes not in yet and quizzes not on the schedule.

**Independent Test**: Quickstart scenario 3.

### Implementation for User Story 2

- [ ] T015 [US2] The Quizzes tab, `apps/web/src/views/meet/QuizzesTab.vue` from `ResultsView.vue`, keeping every action it has but uploading, which moves to the page's header (T008) (FR-013): its stage groups list each scheduled quiz in or not, from the day response, a quiz not in yet showing when and where (FR-014); stored quizzes the schedule doesn't match in their own group from `notOnSchedule`; the division, stage and attention filters acting on the quizzes shown (FR-015). For a viewer or coach the tab is built from the day response alone, which already holds only what FR-024 gives them, with no stored-quiz controls and no attention list; the results list and the attention list are read for admins and officials only (FR-016), re-read on the page's beat (T010); covered by the existing results page specs, moved, a case for a scheduled quiz not in yet, and a case for a viewer's tab in a meet with no published schedule
- [ ] T016 [US2] The attention count on the Quizzes tab's label for admins (FR-003), from the day response's `attention`, in `MeetView.vue`; covered by T009's spec

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - A division's standings and its day (Priority: P2)

**Goal**: A division's tables beside its steps.

**Independent Test**: Quickstart scenario 4.

### Implementation for User Story 3

- [ ] T017 [US3] A division's steps as one component both tabs mount, moved from `StatsSettingsView.vue` (plan.md: "A division's steps"), with its warnings, confirmations and "Preview as viewer"; covered by the existing stats settings specs, moved
- [ ] T018 [US3] The Standings tab, `apps/web/src/views/meet/StandingsTab.vue` from `DivisionStatsView.vue`: one division at a time ("every division" picked shows the first), its tables as today with print and download, the steps for admins (FR-017, FR-018), what will appear and when for a viewer with nothing yet (FR-002), re-reading on the page's beat (T010), what a viewer gets unchanged from today's division stats; covered by the existing division stats specs, moved
- [ ] T019 [US3] The steps in the Setup tab's stats section too (FR-019), the same component as T017; covered by T017's specs

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 4 - One division across the tabs (Priority: P2)

**Goal**: One division picked, kept across tabs and in the address.

**Independent Test**: Quickstart scenario 5.

### Implementation for User Story 4

- [ ] T020 [US4] The division picker in `MeetView.vue`: starts on every division unless `?division=` names one, remembers nothing between visits (FR-004), kept in the query as the reader switches tabs, every division offered where the tab allows it; covered by T009
- [ ] T021 [US4] Signed-out readers of a tab's address are asked to sign in and taken back to it, through #200's `returnPath`; covered by #200's `returnPath.spec.ts` and a case in T009's spec

---

## Phase 7: User Story 5 - The meet day on a phone (Priority: P3)

**Goal**: The page works at phone width, the schedule as a list.

**Independent Test**: Quickstart scenario 8.

### Implementation for User Story 5

- [ ] T022 [US5] A division's quizzes by time for phones, a new `apps/web/src/components/ScheduleList.vue` reusing `ScheduleSeat` for each bench with the same marks, the quiz under way marked, by FR-021's rule (the slot containing the current time in the meet's time zone); `ScheduleSheet` was checked and stays the table it is, since a list by time for one division has no columns to share
- [ ] T023 [US5] The Schedule tab shows the list at phone width (#200's `viewport.ts`) and the sheet otherwise; the tab bar and the division picker scroll sideways on their own, the page never (SC-005)
- [ ] T024 [US5] Browser check at 390 px of every tab (quickstart scenario 8)

---

## Phase 8: Scoresheet benches (FR-023, part of User Story 1's benches)

- [ ] T025 [US1] The scoresheet fills settled benches when it opens a scheduled quiz: `getScheduledQuiz` in `apps/scoresheet/src/api.ts` reads the day response's `benches` and matches each to a roster team by folded name, as it does a drawn letter's team, the fill in `Scoresheet.vue` (`planLink`, `teamForBlank`) unchanged; with the API out of reach it opens the quiz as today (principle I); covered by a case in the scoresheet's scheduled quiz specs; scoresheet MINOR release commit last

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T026 Remove the views the tabs replace (`ScheduleView.vue`, `ResultsView.vue`, `StatsView.vue`, `DivisionStatsView.vue`, `StatsSettingsView.vue`, and `QuizMeetView.vue`'s moved sections), their routes now redirects (FR-020); the stored quiz page, the church teams page and the builder stay
- [ ] T027 Docs in the same PR as the change they describe: `docs/scheduling.md` (bench resolution built, replacing "still to come with #16"; with PR 1), `docs/roles-and-access.md` (the tabs and who sees what, `GET /day`; with PR 2), `docs/architecture.md` (the meet page and its data flow; with PR 2)
- [ ] T028 `ROADMAP.md` and `apps/web/src/views/RoadmapView.vue`: #16 shipped, the meet page described; close #16 with a comment on what shipped, with the maintainer's leave
- [ ] T029 Measure on the deployed Worker with `wrangler tail`: the day response's CPU for the one production meet with results, and that viewers' requests are served from the cache (quickstart scenario 9); record in research R2
- [ ] T030 Run every quickstart scenario in a browser, counting clicks for SC-001 (an admin from any tab to any item's fix: at most two) and SC-002 (a viewer to a division's standings: at most two; to how a scheduled quiz went: one)
- [ ] T031 Release commits last in each PR, one per package, at the levels in the Delivery table

---

## Dependencies & Execution Order

- **PR 1 (T001 to T006)**: none; can start now
- **PR 2 (T007 to T021, T026 to T031)**: T007 waits for #200; T008 to T011 before any story; needs PR 1's `GET /day`
- **US1 (T012 to T014)**: T013 before T014
- **US2 (T015, T016)**: after T008 and T010
- **US3 (T017 to T019)**: T017 before T018 and T019
- **US4 (T020, T021)**: after T008
- **PR 3 (T025)**: after PR 1; independent of PR 2
- **PR 4 (T022 to T024)**: after US1

### Parallel Opportunities

- T001, T003 and T005 (three spec files)
- T009 and T012 (portal and ui specs)
- T015 and T017 once the shell is in (different tabs)
- PR 3 beside PR 2

---

## Implementation Strategy

1. PR 1: benches and the day response, testable through the API and the teams check alone
2. PR 2: the page; User Story 1 is the MVP inside it, the Schedule tab filling in
3. PR 3 and PR 4 follow, each small

---

## Notes

- [P] tasks = different files, no dependencies
- Commit after each task or logical group
- `tasks.md` is excluded from dprint: keep `- [ ]` and `- [X]` as they are
