---

description: "Task list for the schedule builder redesign"
---

# Tasks: Schedule builder redesign

**Input**: Design documents from `/specs/005-schedule-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the
implementation task names the test task or existing test that covers it. The schedule logic is the
feature's validation layer, so every rule in `docs/schedule-invariants.md` gets a test.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing
of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Shared logic: `packages/shared/src/schedule/`, tests in `packages/shared/src/schedule/__tests__/`
- Builder: `apps/web/src/` (views, components, persistence), tests in `apps/web/src/__tests__/`
- Read-only grid: `packages/ui/src/`
- API: `packages/api/src/`, tests in `packages/api/src/routes/__tests__/`
- "Owner" names a row of plan.md's Reuse and Ownership table.

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

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Move the code the plan reuses to where every consumer can reach it, and open the
contract bump.

- [X] T001 Bump `packages/shared` MINOR with a dated changelog section in `packages/shared/CHANGELOG.md` that later commits in this branch extend (Principle V); `tools/check-contract-versions.sh` must pass
- [X] T002 [P] Move the rule-book prelim tables (4 to 21 teams) from `apps/web/src/prelimDraw.ts` into `packages/shared/src/schedule/`, owner "the prelim draw", carrying the cases of `apps/web/src/__tests__/prelimDraw.spec.ts` to `packages/shared/src/schedule/__tests__/`; the old editor keeps importing them from `@qzr/shared` until it's removed (T052)
- [X] T003 [P] Move `useHistory` from `apps/scoresheet/src/composables/useHistory.ts` to `packages/ui/src/` with its tests, and point the scoresheet's imports at `@qzr/ui`; behaviour unchanged, covered by the moved tests

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The document, the rules and the empty builder page every story builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 [P] Tests for the schedule file codec in `packages/shared/src/schedule/__tests__/`: a document saved and reopened is identical, pins and draw included (SC-006); a newer `version` is refused with a message naming both versions; a document failing validation is refused saying what's wrong; an older version opens with defaults (contracts/schedule-file.md)
- [X] T005 The schedule document and its codec, owner "the schedule file codec", in `packages/shared/src/schedule/`: the shape in data-model.md (document, settings, a division's elims, frame rows of kind day, slot, event or note, quiz, seat kinds letter, rank, new, place, points, empty, draw), `SCHEDULE_FILE_VERSION` starting at 1, ids as strings stable for the document's life, validation and upgrade following the pattern of `packages/shared/src/quizFileCodec.ts`; covered by T004
- [X] T006 [P] Tests for the conflict check in `packages/shared/src/schedule/__tests__/`, one case that breaks each hard rule H-1 to H-20 and warning W-1 to W-5 of `docs/schedule-invariants.md` and one that doesn't, asserting the rule's ID and the quizzes marked; an absent team's seat is not an empty seat (H-5); W-4 means the check never reports nothing to fix while the tray holds a quiz; W-5 fires when two quizzes share a result name from `quizName` in `packages/shared/src/results.ts` (research R10)
- [X] T007 The conflict check, owner "the conflict check", in `packages/shared/src/schedule/`: every hard rule and warning keyed by its invariant ID with a short reason, reusing `quizName` and `foldName` from `packages/shared/src/results.ts` for W-5; covered by T006
- [X] T008 The builder page in the portal: a top-level route needing no account beside `/roadmap` in `apps/web/src/router/index.ts`, and the page shell in `apps/web/src/views/` with the left panel of expandable sections (Teams; Time slots and rooms; Prelim settings; Elim settings), only one open at a time (FR-004), and the grid area on the right; the document held in one place with every change going through it, undo and redo via `useHistory` from `@qzr/ui` with whole-document snapshots (FR-006, research R7); in-page confirmations reuse `packages/ui/src/ChoiceDialog.vue` and no browser dialog is used anywhere (FR-007, SC-005); covered by a component test in `apps/web/src/__tests__/` that the page opens signed out, opens one section at a time, and undoes and redoes a change

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Generate a full schedule from team counts (Priority: P1) 🎯 MVP

**Goal**: Team counts in, a complete conflict-free weekend schedule out, in the org's usual shape.

**Independent Test**: Signed out, create a schedule with divisions of 6, 17 and 16 teams: the FBC
2025 shape appears (5 Friday and 3 Saturday prelim rounds at 25 minutes, per-division stats breaks,
XY on 7 to 12, 9-team mains, 8 and 7-team consolations, the 6-team bracket, three Finals in Room 1),
with no hard conflicts.

### Tests for User Story 1

> **NOTE: Where a task adds a new test, write it first and see it fail.**

- [X] T009 [P] [US1] Tests for the prelim draw in `packages/shared/src/schedule/__tests__/`, extending the cases moved in T002: for every team count from 4 to 90, both sources ("Rule book" and "No rematches") give every team exactly the set quizzes per team, never twice in one quiz (H-9); the rotating draw has no rematches from 7 teams up (SC-003, W-1); 6 quizzes per team is two rounds avoiding repeats (FR-025); letters run `A` to `Z` then `AA`… (H-10)
- [X] T010 [P] [US1] Tests for the frame in `packages/shared/src/schedule/__tests__/`: the Weekend, One day and One room presets as FR-015 lists them, default slot length 25 (FR-016), with no team counts a minimal frame of 3 rooms (FR-010), and the default room count as the fewest rooms, at least 3, that fit the prelims (FR-018)
- [X] T011 [P] [US1] Tests for prelim placement in `packages/shared/src/schedule/__tests__/`, with the reference meets of quickstart.md as fixtures: each division in its own block of adjacent rooms in division order (FR-019, P-2); a division borrowing another's room only as late as possible and never back and forth (P-3); prelims packed from the division's first slot (FR-013a); H-1 to H-3, H-9 and H-11 hold; a frame too short leaves quizzes in the tray with the reason, rather than breaking a hard rule (FR-013, story 1 scenario 4)
- [X] T012 [P] [US1] Tests for the default elims in `packages/shared/src/schedule/__tests__/`: FBC 2025 (XY on 7 to 12 with X = 1st, 4th, 6th and Y = 2nd, 3rd, 5th; 9-team mains in snake order 1, 6, 7 / 2, 5, 8 / 3, 4, 9; 8 and 7-team consolations continuing the main lane's letters; deciding quizzes called Finals) and Heritage 2024 (XY on 10 to 15, 12-team main and 2C, 8-team third lane) match the printouts (SC-001); every rank enters exactly once (H-14), every source is earlier (H-12), each division's stats break falls between its last prelim and first elim (H-11, FR-020), the first `New n` quiz leaves the totalling gap (W-3), and Finals default to Room 1, highest division first with each consolation Finals just before its division's, about 25 to 30 minutes apart (FR-019a)
- [X] T013 [P] [US1] Test in `packages/shared/src/schedule/__tests__/` that generating a 60-team, three-division weekend takes under 2 seconds (FR-014, SC-007)

### Implementation for User Story 1

- [X] T014 [P] [US1] The rotating draw and the "No rematches" source, owner "the prelim draw", in `packages/shared/src/schedule/`: quiz `i` gets letters `(i, i + k + 1, i + 2k)` counted round from 1 to `n`, `k` chosen so no two teams meet twice where possible (FR-024); "Rule book" uses the moved tables for 4 to 21 and the rotating draw above; "No rematches" uses the rotating draw from 7 teams and the tables below (FR-023); quizzes labelled `Div <division> Quiz <n>` in draw order (FR-026); covered by T009
- [X] T015 [P] [US1] The frame presets and default rooms, owner "the frame", in `packages/shared/src/schedule/`; covered by T010
- [X] T016 [US1] Prelim placement, owner "prelim placement", in `packages/shared/src/schedule/`, porting the mockup's approach (slot-by-slot search for letter-disjoint quizzes, own rooms first, borrowing latest, research R3): never places a quiz in breach of a hard rule and says what it left in the tray and why; covered by T011
- [X] T017 [US1] Default elims, owner "elim structure" with the library as data (research R9), in `packages/shared/src/schedule/`: lanes stacked down the ranks, a rerank XY intermediate, the library's 5, 6, 7, 8, 9 (both seedings, snake order by default) and 12-team brackets as written in `specs/005-schedule-redesign/bracket-library.md`, the FR-030 defaults for every size up to 9, 12, 13 to 18 and 19 and up with FR-030's rule for what's left below the main lane, lane letters continuing by default (FR-033), the deciding quiz called Finals by default (FR-034), and the Finals sequence default (FR-019a); covered by T012
- [X] T018 [US1] Generation as re-flow with nothing pinned, owner "re-flow", in `packages/shared/src/schedule/`: frame, prelims, stats breaks, elims and Finals from the settings in one call, satisfying H-1 to H-17 (FR-009); covered by T011, T012 and T013
- [X] T019 [US1] The Teams section in the builder page (`apps/web/src/components/`): the number of divisions, each division's name and team count, with the schedule generated as counts are entered (FR-021, story 1 scenario 1); a new schedule with no counts shows the minimal frame (FR-010); covered by a component test in `apps/web/src/__tests__/` entering 6, 17 and 16 teams and finding no hard conflict
- [X] T020 [US1] The schedule grid in `packages/ui/src/ScheduleGrid.vue`, owner "The schedule grid (builder, portal, print)", reworked to read a schedule document and reusing what still applies of `packages/ui/src/scheduleGrid.ts`, following `specs/005-schedule-redesign/mockup.html`; the builder (`apps/web/src/components/`) renders it with its editing on top, so one component draws the grid for the builder, the portal and printing; its current users (the scoresheet's `apps/scoresheet/src/components/SchedulePickerDialog.vue` until T051, the old editor's `apps/web/src/components/schedule/ReviewSection.vue` until T052) keep building and working on their current data in the same change, so every commit builds: day headings, time column, event rows spanning all rooms or one room, note rows, quiz cards with their seats in letters (story 1 scenario 3), each room's header listing every division that uses it, Finals aside (FR-019), cells marked with the conflict check's rule ID and reason and running counts with a way to step through them (FR-037), and the unplaced tray with its reasons; covered by a component test in `apps/web/src/__tests__/` rendering the FBC fixture

**Checkpoint**: User Story 1 is the MVP: a director with only team counts sees a full schedule

---

## Phase 4: User Story 2 - Adjust settings and watch the schedule follow (Priority: P1)

**Goal**: Settings on the left re-flow the grid, leaving hand-edited (pinned) quizzes alone.

**Independent Test**: Drag two quizzes, then change a team count, the slot length and the room
count: the dragged quizzes haven't moved and everything else re-flowed with no hard conflicts. With
Auto-apply off, a change is marked unapplied with its applied value until Apply.

### Tests for User Story 2

- [X] T021 [P] [US2] Tests for re-flow in `packages/shared/src/schedule/__tests__/`: no settings change moves, changes or deletes a pinned quiz (H-19, SC-004); a pinned quiz that no longer fits is kept and marked with the conflict it now causes (story 2 scenario 3); unpinning hands a quiz back to the generator, and unpinning a section or division unpins everything in it (FR-011); a room removed while holding pinned quizzes sends them to the tray, still pinned; the list of unapplied settings, each with its applied value, and how many quizzes Apply will move (FR-012a)

### Implementation for User Story 2

- [X] T022 [US2] Re-flow around pins and the unapplied list, owner "re-flow", in `packages/shared/src/schedule/`; covered by T021
- [X] T023 [US2] The Time slots and rooms section and the Prelim settings section in the builder page (`apps/web/src/components/`): frame preset, slot length, room count fixed or "as many as needed", events, quizzes per team, and the prelim draw source with an (i) saying that both options give every team the same number of quizzes against different opponents, that the rule book has no tables over 21 teams, that its 8-team table has a pair meeting twice, and that the draw makes the letters random (FR-008, FR-015 to FR-018, FR-022, FR-023); each division's stats break time shown in the Time slots section (FR-020); the Finals' order, spacing and rooms, two side by side allowed, defaulting as FR-019a says (FR-019a); covered by a component test in `apps/web/src/__tests__/` changing the room count and finding a new room column with unpinned quizzes re-flowed (story 2 scenario 1)
- [X] T024 [US2] The Auto-apply switch at the top of the left panel and the Apply bar (`apps/web/src/components/`), reading the unapplied list from re-flow: each unapplied setting marked beside itself with its applied value, each section's count, Apply first saying how many quizzes will move, Auto-apply on by default (FR-012a, story 2 scenario 6); covered by a component test in `apps/web/src/__tests__/`

**Checkpoint**: User Stories 1 and 2 work together: generate, then steer

---

## Phase 5: User Story 3 - Edit the grid directly (Priority: P1)

**Goal**: Everything can be done by hand on the grid, nothing refused, every change undoable.

**Independent Test**: Move a quiz, swap two quizzes, swap two seats, insert a slot, add a single-room
event and a note row, delete a quiz; undo all, redo all. Each step's grid is as expected, conflicts
appear and clear in the page, and no browser dialog appears.

### Implementation for User Story 3

- [X] T025 [US3] The quiz menu on the grid (`apps/web/src/components/`): clicking a quiz opens a popup with rename, its seats, move, move to the unplaced tray, pin or unpin, and delete; a seat's editor sets any source kind (prelim letter, prelim rank, `New n`, a place in any other quiz, a place in points) whatever the quiz's phase (FR-035a, story 3 scenario 7); a seat editor opened from the menu leads back to it; every popup closes with an × or a click elsewhere (FR-005c); any hand edit pins what it touched (FR-011) and nothing is refused, a rule broken being marked by the conflict check (story 3 scenario 8); renaming keeps every seat that refers to the quiz, since seats refer by id (FR-035c, H-7); covered by a component test in `apps/web/src/__tests__/` renaming a quiz referred to as `2 of C` and finding `2 of C2`
- [X] T026 [US3] Drag and select-then-choose on the grid (`apps/web/src/components/`), with pointer events as the portal's `apps/web/src/composables/useDragReorder.ts` does: drag a quiz to an empty cell to move it or onto another to swap, drag a seat onto another to swap them, a dragged seat shown as a chip of its text, and every drag also doable by selecting then choosing, by click, tap or keyboard (FR-005a, story 3 scenarios 1 to 4); covered by a component test in `apps/web/src/__tests__/` moving, swapping and swapping seats both ways
- [X] T027 [US3] Rows and rooms on the grid (`apps/web/src/components/`): clicking a time or event retimes it, sets its length, renames or deletes it, or inserts a slot, event or note row, later times unchanged unless the director shifts them (FR-016, FR-017, story 3 scenario 5); an event can span all rooms or one (H-3); clicking a room's name renames or removes it, and the grid can add a room (FR-005c); covered by a component test in `apps/web/src/__tests__/`
- [X] T028 [US3] Phone layout for the builder page (`apps/web/src/views/` and its components): the settings panel opens as a sheet over the grid, and the grid scrolls sideways with its time column fixed (FR-005b); covered by a component test at a phone width in `apps/web/src/__tests__/` moving a quiz and changing a seat by select-then-choose

**Checkpoint**: Stories 1 to 3 give the full build loop: generate, steer, fix by hand

---

## Phase 6: User Story 4 - Elims shaped by division size (Priority: P2)

**Goal**: Every elim structure in the org's printouts and CMQ's workbook reachable from Elim
settings alone.

**Independent Test**: Divisions of 6, 10, 11, 12, 14, 17, 21 and 32 teams each get the shape the
org's meets used (FR-030); CMQ's 36 and 14 teams in 9 rooms reach its structure by settings alone.

### Tests for User Story 4

- [X] T029 [P] [US4] Tests for the bracket library in `packages/shared/src/schedule/__tests__/`: every entry, at its size, satisfies H-12 to H-16 and has one deciding quiz; the 10-team entry is the 9-team bracket with New 10 entering its bottom placing quiz G = 3 of F, 2 of F, New 10; the 11-team entry has a play-in X on 9 to 11 whose winner takes seed 9 (A = 1, 4, 1 of X) and whose other two join G = 2 of F, 2 of X, 3 of X; every entry matches `specs/005-schedule-redesign/bracket-library.md` (FR-029, FR-030)
- [X] T030 [P] [US4] Tests for elim settings in `packages/shared/src/schedule/__tests__/`, with fixtures from quickstart.md: Heritage 2025 (10 with a rerank X on 8 to 10, 14 with a 5-team consolation, 21 with a 9-team 3C), Heritage 2023 Div 1 (11), Nov 2021 Div 2 (22: a 10-team round-robin 2C, 3 each, Finals on points), CMQ (WXYZ on 9 to 20 seated W = 1st, 8th, 9th…, 12-team A and K lanes, a B round robin of 3 each with a Final on points, lanes that each restart at A and so raise W-5 unless renamed); intermediates of one to four quizzes, rerank or play-in, with the window sliding and keeping at least one rank on each side, and names doubling on the second line (XX, XXYY) (FR-028); removing an intermediate regenerates the lanes keeping pinned quizzes (story 4 scenario 3); a lane size with no library bracket gives placeholder quizzes with a message (FR-036); a consolation bracket with Finals off keeps its deciding quiz, named as the lane's next letter (story 4 scenario 4); a round robin of 8 with 2 each gives 6 quizzes by rank only, no three teams meeting twice (story 4 scenario 6)

### Implementation for User Story 4

- [X] T031 [US4] The rest of the bracket library as data, owner "the library", in `packages/shared/src/schedule/`: the 10, 11 and 14-team entries of `specs/005-schedule-redesign/bracket-library.md` and the rule book's Brackets A, B and C from `docs/rules.md`; other sizes stay without a bracket (FR-036); covered by T029
- [X] T032 [US4] Intermediates, round robins, Finals naming, labels and lettering, owner "elim structure", in `packages/shared/src/schedule/`: intermediates of one to four quizzes (X, XY, XYZ, WXYZ) with their default windows and seating, rerank (`New n`, H-16) or play-in (places into seats, the rest to the lane below or extra quizzes); round-robin lanes of 1 to 3 quizzes each, walking the ranks with every other pass mixed and a short last quiz topped up from the top, with an optional Finals seated 1st, 2nd and 3rd in points (FR-029, FR-034); the deciding quiz called Finals or the lane's next letter; lane labels (suffix, division name, own name) and lettering (continue or restart) (FR-033); a changed lane rebuilds only its unpinned quizzes (FR-031); covered by T030
- [X] T033 [US4] The Elim settings section (`apps/web/src/components/`), following the mockup: per division, lanes first ("Top 9 → Div 2", "The rest → Div 2C") with split and merge, an intermediate on any line with its size, kind, ▲▼ window and seating, each lane's format, bracket, quizzes each, Finals and label and lettering, and the totalling gap setting with an (i) (FR-027, FR-028, FR-028a, FR-031, FR-033, FR-034); covered by a component test in `apps/web/src/__tests__/` turning a 2C into a round robin and finding its quizzes rebuilt

**Checkpoint**: Elims cover every reference structure from settings

---

## Phase 7: User Story 5 - Keep, share and print a schedule without a meet (Priority: P2)

**Goal**: Work survives in the browser, travels as a file, and prints.

**Independent Test**: Build, reload, find it as left; save to a file, open it in another browser,
identical; print the room grid, the one-room list and the basic schedule.

### Implementation for User Story 5

- [X] T034 [US5] Keeping schedules in the browser, owner "the builder's persistence" in `apps/web/src/`, following the pattern of `apps/scoresheet/src/persistence/autoSave.ts` (not imported: it saves the quiz store): every change saved at once, one key per schedule plus an index (research R4); the list of schedules with create, rename, duplicate and delete (FR-002); cleared browser storage reported in the page rather than failing; covered by a test in `apps/web/src/__tests__/` reloading and finding the schedule as left, pins included (story 5 scenario 1), and editing and saving to the browser and a file with the network off once the page is open (FR-001)
- [X] T035 [US5] Saving to and opening from a `.qzrschedule.json` file, owner "the builder's persistence", reusing the browser path of `apps/scoresheet/src/persistence/fileIO.ts` (save picker where there is one, download otherwise, file input to open) and the codec from T005; a newer or invalid file fails with its message and loses nothing open (FR-003, story 5 scenarios 2 and 3); covered by T004 and a test in `apps/web/src/__tests__/`
- [X] T036 [US5] Printing and the other views of the grid from T020 in `packages/ui/src/ScheduleGrid.vue`, with print CSS: the room grid on one or more pages per day with the time column on each, avoiding quizzes split across a page break; a one-room list in time order; the basic schedule with consecutive quiz slots collapsed into "Quizzing" rows between events (FR-044); letters or drawn teams by a Letters / Teams toggle above the grid, letters until a draw exists (FR-043); the builder prints through it with `window.print()`; covered by a component test in `packages/ui/src/` for each view

**Checkpoint**: A standalone director can keep, share and print a schedule

---

## Phase 8: User Story 6 - The draw: assign teams to letters (Priority: P2)

**Goal**: Team names onto letters, with late teams playing late, without moving the schedule; Sort
when lateness is learned after.

**Independent Test**: Enter names for a 9-team division, mark two late, draw: every team holds one
letter, both late teams' first quizzes are the latest available, and no quiz moved.

### Tests for User Story 6

- [X] T037 [P] [US6] Tests for the draw in `packages/shared/src/schedule/__tests__/`: letters and teams one to one (H-18); random apart from late teams, who get letters putting them in as few prelim quizzes as possible, preferring the latest (FR-041, story 6 scenario 2); W-2 when a late team still plays the first slot; drawing, redrawing and clearing per division and for all (FR-040); a team count change flags the draw to be redone (FR-042); marking a team absent changes no quiz and its seats count as present (FR-042b, H-5); the draw never changes the schedule (FR-039)
- [X] T038 [P] [US6] Tests for Sort in `packages/shared/src/schedule/__tests__/`, with this case as a fixture: the FBC 2025 counts (6, 17, 16 in 5 rooms, 5 Friday and 3 Saturday prelim rounds), two teams of Div 2 and one of Div 3 marked late and drawn, after which Sort puts every quiz of all three late teams on Saturday, and Sort across rooms does the same with no room going from one division to another and back; Sort places prelims in quiz order with late teams' quizzes in the latest cells, including empty cells and free cells in other divisions' rooms, the rest staying in their division's rooms; Sort across rooms keeps each division a block of adjacent rooms and moves each line between blocks at most once, so no room switches back (FR-042a, P-1 to P-3); pinned quizzes stay unless included; Sort says how many quizzes will move before it applies

### Implementation for User Story 6

- [X] T039 [P] [US6] The draw, owner "the draw", in `packages/shared/src/schedule/`, porting the mockup's late-team scoring (research R3); covered by T037
- [X] T040 [P] [US6] Sort and Sort across rooms, owner "prelim placement" (Sort is placement with lateness), in `packages/shared/src/schedule/`, porting the mockup's block-edge search; covered by T038
- [X] T041 [US6] The draw in the builder (`apps/web/src/components/`): team names in Teams, typed when standalone (FR-021); in Prelim settings, late teams behind a collapsed row showing who is marked, absent marks, Draw, Redraw and Clear per division and for all, and Sort buttons with Sort across rooms and the count of quizzes that will move (FR-040, FR-042a, FR-042b); a team dropping out offers both lowering the count and marking absent, picking neither (FR-042b); the Letters / Teams toggle from T036 in the builder, a prelim seat's editor showing each letter with its drawn team (FR-043); covered by a component test in `apps/web/src/__tests__/` drawing with two late teams and finding no quiz moved

**Checkpoint**: Standalone schedules are complete, teams included

---

## Phase 9: User Story 7 - Link a schedule to a meet (Priority: P3)

**Goal**: A meet's schedule built, saved, published and versioned in the builder; the portal viewer
and the scoresheet's picker read the newest published version.

**Independent Test**: Link a schedule to a meet, publish, edit without publishing: the portal view
shows the published version and the scoresheet loads a published quiz with the right teams. Publish
twice more: three versions, any one restorable as the draft.

### Tests for User Story 7

- [X] T042 [P] [US7] Route tests in `packages/api/src/routes/__tests__/schedule.spec.ts`, extending its existing fixtures, for every route in contracts/api.md: admin and superuser only for the draft, publish, versions, restore and unlink routes, and any access to the meet (membership, a guest token for the meet, superuser) for the published read (Principle IV); a draft save with a stale `baseRevision` gets 409 with the newer draft; publish with hard conflicts and no `confirmConflicts` gets 409 with the conflicts, and with it publishes; each publish adds the next version with when and by whom, and none is updated or deleted, unlinking included; restore copies a version into the draft and publishes nothing; the published read gives letters in `registration` and `build` with team names removed, and team names in `live`, `review` and `done` (FR-052); publishing adds and renames the meet's rooms and removes an unused room unless it has an official code, which is kept and listed; `results` lists the result names with submitted results (research R10)
- [X] T043 [P] [US7] Tests for converting a meet built with the old editor, in `packages/api/src/routes/__tests__/schedule.spec.ts`, extending `packages/api/seed-schedule.sql` data: the first open builds a document from `meet_slots`, `scheduled_quizzes`, `scheduled_quiz_seats` and `prelim_assignments`, every quiz pinned, placeholder elim seats empty, quiz ids the old row ids as strings, stored as the draft and as version 1, late marks seeded from `teams.lateness` (FR-053, SC-008, research R5, R6); and `GET /:id/rooms`, `/:id/slots`, `/:id/quizzes` and `/:id/quizzes/:quizId/teams` answer in their current shapes from the newest published version

### Implementation for User Story 7

- [X] T044 [US7] The `meet_schedules` table ("`meetId` Unique; a meet has at most one linked schedule"; `draft`; `draftRevision` "Increments on every save"; `draftSavedAt`) and the append-only `meet_schedule_versions` table (`meetId`; `version` "1, 2, 3, … per meet; unique with `meetId`"; `document`; `publishedAt`; `publishedBy` "The admin's user id"; rows "never updated or deleted while the meet exists, unlinking included") in `packages/api/src/db/schema.ts`, with the migration generated by `pnpm --filter @qzr/api db:generate`, never hand-written (Principle VI)
- [X] T045 [US7] The linked-schedule routes of contracts/api.md in `packages/api/src/routes/schedule.ts`, owner "Draft save, publish, versions and restore, conversion of old meets", reusing `requireAdmin` and `requireViewer` from the same file, the codec and the conflict check from `@qzr/shared` for validation and publish conflicts, and `packages/shared/src/phases.ts` for what a reader sees; conversion of old meets on first open; covered by T042 and T043
- [X] T046 [US7] The old read routes (`GET /:id/rooms`, `/:id/slots`, `/:id/quizzes`, `/:id/quizzes/:quizId/teams`) in `packages/api/src/routes/schedule.ts` answering from the newest published version in their current shapes, so installed scoresheets keep working (plan Complexity Tracking); `POST /:id/schedule/sync` and the room `PATCH` left in place, unwritten by any client; covered by T043
- [X] T047 [US7] The builder on a linked schedule (`apps/web/src/`): the meet's `schedule/edit` route opens the builder on the meet's draft, or starts one from the meet (story 7 scenario 1); divisions, teams and rooms come from the existing `GET /api/meets/:id`, `/teams` and `/rooms` routes, the draw storing meet team ids (FR-047); linking a standalone schedule shows its divisions and rooms matched to the meet's, mismatches listed, nothing linked until confirmed (FR-046); unlinking leaves a standalone schedule (FR-048); covered by a component test in `apps/web/src/__tests__/` with the API stubbed as `apps/web/src/__tests__/api.spec.ts` does
- [X] T048 [US7] Saving a linked draft, owner "the builder's persistence": kept in the browser at once and sent shortly after each change, the state shown ("Saving…", "Saved", "Not saved: offline"), unsent edits sent when the server is reachable again, after a reload too, and a draft changed meanwhile by another admin shown beside the director's in the page to keep theirs or take the server's, never overwritten silently (FR-048a); covered by a test in `apps/web/src/__tests__/` going offline, editing, reloading, and coming back
- [X] T049 [US7] Publishing and history in the builder (`apps/web/src/components/`): Publish lists hard conflicts and warnings, publishing after an in-page confirmation when there are hard conflicts and without asking for warnings alone, never refused (FR-049, story 7 scenario 3); publishing turns Auto-apply off (FR-012a, story 2 scenario 7); an "unpublished changes" marker while the draft differs (story 7 scenario 4); the history lists versions with when and by whom, views any read-only through the grid from T036, and restores one as the draft (FR-049a, story 7 scenario 5); quizzes with results are protected, edited only after an in-page confirmation and then marked changed after results (FR-035b, H-20); covered by a component test in `apps/web/src/__tests__/`
- [X] T050 [P] [US7] The portal's schedule view `apps/web/src/views/ScheduleView.vue` reading `GET /api/meets/:id/schedule/published` through the grid from T036, in letters or teams as the response's `view` says (FR-050, FR-052), keeping its scoresheet links `?meetId=<id>&quiz=<id>` with document quiz ids (contracts/schedule-file.md); covered by a component test in `apps/web/src/__tests__/`
- [X] T051 [P] [US7] The scoresheet's picker `apps/scoresheet/src/components/SchedulePickerDialog.vue` and `apps/scoresheet/src/api.ts` reading the published document, resolving a quiz's teams with the shared functions and filling the quiz's division, consolation flag and number or letter so its results are saved under the schedule's result name (FR-050, research R10); with the API down it degrades as today (Principle I); covered by a new picker test in `apps/scoresheet/src/components/__tests__/` (it has none yet), built on the stubs of `MeetPickerDialog.spec.ts` there

**Checkpoint**: All user stories work independently

---

## Phase 9b: Events as cell items (FR-017 amended)

**Goal**: events sit in rows like quizzes, over any set of rooms, and can be moved, dragged,
unplaced, pinned and turned into quizzes and back.

- [X] T057 [US3] Schema in `packages/shared/src/schedule/scheduleFile.ts`: drop the `event` frame row, add slot use `event` and `ScheduleDocument.events` (`id`, `label`, `slot` or null, `rooms` or `all`, `pinned`); tests in `packages/shared/src/schedule/__tests__/scheduleFile.spec.ts`
- [X] T058 [US3] `packages/shared/src/schedule/frame.ts`: `buildFrame` returns rows and events (event slots for Breakfast, Lunch and the rest), and `eventCells` reads events; `reflow.ts` keeps the frame when any event is pinned, skips event slots, and rebuilds events with the frame; `conflicts.ts` H-3 from events; tests in `frame.spec.ts`, `reflowPins.spec.ts`, `conflicts.spec.ts`
- [X] T059 [US3] `packages/shared/src/schedule/sheet.ts`: `sheetRows` gives each slot's cells with events merged across adjacent rooms and marks a row with no quizzes and every room taken by events as short; `basicRows` lists all-rooms events; tests in `sheet.spec.ts`
- [X] T060 [US3] `packages/ui/src/ScheduleSheet.vue`: draw event cells with their span, short event rows, and emit `event` when one is clicked
- [X] T061 [US3] Builder: `apps/web/src/builder/edits.ts` event edits (add, move, rooms, rename, to tray, delete, turn into quiz and back); an event's menu on the grid beside the quiz's (rename, rooms or all, move, to Unplaced, pin, delete, turn into a quiz), reusing `BuilderPopover.vue`; Turn into event in `QuizMenu.vue`; `RowMenu.vue` inserts an event slot with an all-rooms event; the empty cell's + offers a quiz or an event; drag and move mode carry events, an event moved to a cell keeping its rooms shifted to start there, or staying all; Unplaced lists them; tests in `apps/web/src/__tests__/BuilderGrid.spec.ts`
- [X] T062 [US7] `packages/api/src/lib/scheduleLegacy.ts`: old event slots convert to an event slot and an all-rooms event, and the old read routes report an event slot whose rooms are all taken as an event; tests in `packages/api/src/__tests__/`
- [X] T063 [P] [US3] Amend `docs/scheduling.md` (Slot and Event in the glossary, and the builder section) and `specs/005-schedule-redesign/contracts/schedule-file.md` (the document's `events`, and slots made for events) to the model above, as Principle II requires

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Retire the old editor, amend the docs, release

- [X] T052 Remove the old editor and its tests: `apps/web/src/views/ScheduleEditView.vue`, `apps/web/src/components/schedule/`, `apps/web/src/composables/useScheduleData.ts`, `apps/web/src/scheduleAlloc.ts`, `scheduleArrange.ts`, `scheduleBuild.ts`, `scheduleGrid.ts`, `scheduleSort.ts`, `brackets.ts`, `prelimDraw.ts` and their specs in `apps/web/src/__tests__/`, after mining `scheduleScenarios.spec.ts` for cases the shared tests don't yet cover (research R3); the old schedule-sync types in `apps/web/src/api.ts` go too
- [X] T053 [P] Amend `docs/scheduling.md` (the builder in the portal, generation with pins, per-division stats breaks, lanes and intermediates, document storage with draft and versions, the old tables kept unwritten), `docs/data-model.md` (`meet_schedules`, `meet_schedule_versions`), `docs/architecture.md` (the builder and `packages/shared/src/schedule/`) and `docs/example-winkler-2026.md` §4 (CMQ's tables for 4 to 90 teams), as Principle II requires
- [X] T054 [P] Record the future work in `ROADMAP.md`, kept in step with `apps/web/src/views/RoadmapView.vue`: recording a quiz's lane in the scoresheet's quiz file so results from two consolation lanes can't share a name (W-5), and removing the old schedule tables, `/schedule/sync` and the old read routes once no supported scoresheet release calls them
- [X] T055 Releases: api MINOR, web MINOR and scoresheet PATCH (`@qzr/ui` is private, bundled into web and the scoresheet, and unversioned), each with its changelog entry and a `### Bundled contract` section naming the shared version from T001; `tools/check-contract-versions.sh --ci` must pass
- [X] T056 Run `pnpm test:unit`, `pnpm type-check` and `pnpm lint`, then walk the manual scenarios in `specs/005-schedule-redesign/quickstart.md` (scenario 7, phones, moves to #139 with the phone layout)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: After Setup; blocks every story
- **User Stories (Phase 3 to 9)**: After Foundational
- **Polish (Phase 10)**: T052 after US7 (the old editor's route is replaced by T047); T053 to T056 after every story

### User Story Dependencies

- **US1 (P1)**: After Foundational. The MVP.
- **US2 (P1)**: After US1 (re-flow extends generation, T018 → T022).
- **US3 (P1)**: After US1 (edits the grid from T020); independent of US2.
- **US4 (P2)**: After US1 (extends the elim structure and library from T017).
- **US5 (P2)**: After Foundational for persistence (T034, T035); T036 after T020, and used by US6 and US7.
- **US6 (P2)**: After US1; T041 uses T036 for the toggle.
- **US7 (P3)**: After US1 and US5 (T049 and T050 use the grid from T020 and T036); T044 can start any time after Setup.

### Within Each User Story

- A new test is written, and seen to fail, before the implementation it covers
- An owner from plan.md's "Reuse and Ownership" table before the tasks that call it
- Shared logic before the builder UI that uses it
- Story complete before moving to next priority

### Parallel Opportunities

- T002 and T003 in Setup
- T004 and T006 (then T005 and T007) in Foundational
- In US1, the tests T009 to T013 together; then T014 and T015 together
- In US4, T029 and T030 together
- In US6, T037 and T038, then T039 and T040
- In US7, T042 and T043 together; T050 and T051 together once T045 is in
- US3, US4, US5 and US6 can proceed side by side once US1 is done

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "Tests for the prelim draw in packages/shared/src/schedule/__tests__/"
Task: "Tests for the frame in packages/shared/src/schedule/__tests__/"
Task: "Tests for prelim placement in packages/shared/src/schedule/__tests__/"
Task: "Tests for the default elims in packages/shared/src/schedule/__tests__/"
Task: "Generation-time test in packages/shared/src/schedule/__tests__/"

# Then the independent owners:
Task: "The rotating draw and the No rematches source"
Task: "The frame presets and default rooms"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: team counts in, the FBC 2025 shape out, no hard conflicts

### Incremental Delivery

1. Setup + Foundational
2. US1 → validate (MVP: generate)
3. US2 and US3 → validate (steer and fix by hand)
4. US4 → validate (every reference elim structure)
5. US5 and US6 → validate (keep, print, draw: a standalone tool complete)
6. US7 → validate (meets: draft, publish, history, readers)
7. Polish: retire the old editor, docs, releases

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
