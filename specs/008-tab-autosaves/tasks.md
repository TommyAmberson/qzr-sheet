---

description: "Task list for each scoresheet tab keeping its own quiz, and recent quizzes"
---

# Tasks: Each scoresheet tab keeps its own quiz, and recent quizzes are kept

**Input**: Design documents from `/specs/008-tab-autosaves/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the implementation task names the test task or existing test that covers it. No scoring or validation code changes here, so the principle requires none; the plan (research R16) still has each behaviour proved by a test written first. Several tabs, reload, crash and duplicate are checked by hand (quickstart.md), since jsdom has one page.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Everything is in `apps/scoresheet/src/` unless a path says otherwise; tests sit in `__tests__/` beside the code.
- "Owner" names a row of plan.md's Reuse and Ownership table; "R*n*" a decision in research.md.

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

**Purpose**: dependencies, test environment, and the constitution wording the design relies on

- [X] T001 Add `idb` to `apps/scoresheet/package.json` dependencies and `fake-indexeddb` to its devDependencies (`pnpm install`), and give the scoresheet's Vitest run IndexedDB from `fake-indexeddb` and a small Web Locks stand-in (exclusive locks, `ifAvailable`, `query`, released on demand to imitate a closed tab) through a setup file named in `apps/scoresheet/vitest.config.ts`. No test setup file exists today, and jsdom has neither API, so this is the one shared fixture the storage tests extend (research R16).
- [X] T002 [P] Reword principle I's auto-save line in `.specify/memory/constitution.md` from `localStorage` to "kept on the device on every change" through `/speckit-constitution`, as a PATCH amendment (version and amendment date updated), its gate in `.specify/templates/overrides/plan-template.md` unchanged (plan: Complexity Tracking). Keep its Sync Impact Report in `~/notes/sheet/notes.md` for the pull request body (constitution Governance).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the canonical quiz state, undo steps as data, and the quiz records store, which every story builds on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 [P] Extend `persistence/__tests__/quizFile.spec.ts` with the canonical quiz file (research R4): the same quiz reached by edits in different orders (answers, question types, no-jumps set in another order) gives the same canonical form; changing any answer, name, timeout, on-time mark, question type or quiz setting gives a different one; the meet link is not part of it.
- [X] T004 Add the canonical quiz file beside `storeToQuizFile` in `persistence/quizFile.ts` (owner: "Canonical quiz file and saved status"), reusing `storeToQuizFile` and `serialize`. Covered by T003.
- [X] T005 [P] Extend `composables/__tests__/useHistory.spec.ts` for `packages/ui/src/useHistory.ts` (research R5): steps of a caller's own type go in and come out; the undo and redo stacks can be read and set, and undo and redo work on stacks set that way; the limit passed in is kept (1000 steps, the oldest falling off); the default limit and `isDirty`/`markSaved` behave as today for the schedule builder.
- [X] T006 Give `useHistory` in `packages/ui/src/useHistory.ts` a type parameter for its steps and a way to read and set its stacks (owner: "Undo steps as data"), keeping its closures, default limit and `isDirty` for `apps/web/src/composables/useScheduleBuilder.ts`, which is otherwise untouched. Covered by T005.
- [ ] T007 [P] Extend `composables/__tests__/useScoresheet.spec.ts` with undo steps as data (research R5; data-model.md "An undo step"): for each undoable edit (an answer, a team swap, a no-jump, adding, upgrading, toggling and removing a timeout, and an `editAsOne` edit), undo and redo give the same quiz after the stacks have been through `JSON.stringify` and back as before; a swap's meet-picks action runs on undo and redo in the session and is absent from the stored step; names, on-time marks, question types and quizzer order stay out of history, as today; the scoresheet keeps up to 1000 steps.
- [ ] T008 Record undo steps as data in `composables/useScoresheet.ts` at every `history.push` site and in `editAsOne`'s caller in `components/Scoresheet.vue` (owner: "Undo steps as data"): each step holds, for each part of the quiz the edit changed, "its value before and after" ("one answer, one no-jump, one team's timeouts, one question type, one field of a team or quizzer, and one quiz setting; a part absent before or after is empty", data-model.md), and undo writes the before values, redo the after values. Keep `swapTeams`'s `alongside` as an in-memory part that is not stored. Pass a limit of 1000. Covered by T007.
- [ ] T009 [P] Rewrite `persistence/__tests__/autoSave.spec.ts` for the quiz records store (data-model.md; research R1, R2, R10), on T001's fixture: a record written is read back with every field; one of two tabs claiming the same record gets it and the other is refused; a record whose lock is released lists as recent and one still locked does not; deleting a record and the `meta` bookkeeping (`dropped`, `migrated`) work; without Web Locks every record but the tab's own lists as recent; a write refused for lack of room is reported, not thrown away silently.
- [ ] T010 Rewrite `persistence/autoSave.ts` as the quiz records store (owners: "Reading and writing quiz records", "Which record a tab shows"): IndexedDB `qzr-sheet` with stores `quizzes` (keyed by `id`) and `meta`, through `idb`; records with the fields of data-model.md "Quiz record" (`id`, `current`, `start`, `saved`, `submitted`, `ahead`, `link`, `fromNewerFile`, `newerRaw`, `unsaved`, `changedAt`, `offered`); claiming a record by the exclusive Web Lock `qzr-sheet:quiz:<id>` with `ifAvailable`, except that the tab's own record, named in `sessionStorage`, waits up to a second for its lock before it counts as held (a reload's old page may not have let go yet); listing recent records as those no tab holds; counting open tabs from held locks; behaving as one tab when `navigator.locks` is missing (R2). Keep `parseQuizFile`'s use for reading. The old `localStorage` functions go once their callers move (T012 to T016). Covered by T009.

**Checkpoint**: the store, the canonical state and stored undo steps exist; the sheet still runs on the old auto-save until US1 moves it

---

## Phase 3: User Story 1 - Several quizzes open at once, each kept (Priority: P1) 🎯 MVP

**Goal**: every tab writes and reloads its own quiz and meet link, and none disturbs another.

**Independent Test**: open three quizzes from the portal in three tabs, edit one, reload each in turn: each shows the quiz it had, linked as it was, and no tab asked about another tab's changes (quickstart "1. Several tabs").

### Tests for User Story 1

> **NOTE: Where a task adds a new test, write it first and see it fail.**

- [ ] T011 [P] [US1] Extend `persistence/__tests__/autoSave.spec.ts` with a tab's start (research R2; FR-002, FR-004, FR-005): a tab with no id in `sessionStorage` `qzr-sheet:quiz` begins a new record and stores its id; a tab whose id names a free record (reload, restored session) claims it and gets its quiz and link back; a tab whose id names a record another tab holds (duplicated) gets a copy under a new id, with the same state and link and `offered` true, and from then on writes only its copy; a tab whose record is released shortly after it starts (a reload) claims that record, not a copy.
- [ ] T012 [P] [US1] Extend `composables/__tests__/useScoresheet.spec.ts` and `composables/__tests__/useMeetSession.spec.ts` with the tab's writer (research R3, R13; FR-001, FR-006): every change, including `loadFile`, `resetStore`, `clearAnswers` and `clearNames`, reaches the tab's record through one debounced write; nothing is written while `pauseAutoSave` is set; the meet link is written into the same record and read back from it, with the field migrations `useMeetSession`'s load applies today; `qzr-meet-session` is neither read nor written.
- [ ] T013 [US1] Extend `persistence/__tests__/autoSave.spec.ts` with moving from the previous version (research R11; FR-017): `qzr-sheet:current` with `qzr-meet-session` and `qzr-sheet:opened-from-newer-file` become the starting tab's record with an empty undo history and no saved state; each `qzr-sheet:newer-autosave:*` becomes a recent record with `newerRaw`; a tutorial snapshot left by a crash wins over `qzr-sheet:current`; only one of two tabs starting together moves anything (lock `qzr-sheet:migrate`); a key whose record could not be written stays for the next start; `migrated` is set once done.

### Implementation for User Story 1

- [ ] T014 [US1] Start each tab from its own record (owner: "A tab's start"): in `main.ts`, before mounting, move the previous version's keys (T013) and claim or begin the tab's record (T011) through the records store, then give `useScoresheet` its record in place of `loadFromStorage` in `composables/useScoresheet.ts`. Covered by T011, T013.
- [ ] T015 [US1] Make `schedulePersist` in `composables/useScoresheet.ts` the tab's one writer to its record (owner: "Writing the tab's quiz, link and history"): `loadFile`, `resetStore`, `clearAnswers`, `clearNames` and `discardKeptNewerAutoSave` stop writing storage themselves; still debounced 300 ms and paused by `pauseAutoSave`; flushed on `pagehide`. Move the meet link's `persist` and load in `composables/useMeetSession.ts` onto the same record (owner: "The meet link of a quiz"), keeping its field migrations; `qzr-meet-session` goes. Move `fromNewerFile` onto the record and remove `persistence/openedFromNewerFile.ts`. Covered by T012.
- [ ] T016 [US1] Drop the tutorial's own copies in `composables/useTutorial.ts` (owner: "The tutorial's safekeeping"; research R12; FR-018): it pauses the writer, and on finish the tab loads its own record again, quiz and link; after a crash the reload does the same. `qzr-sheet:tutorial-snapshot`, `qzr-sheet:tutorial-meet-snapshot` and the tutorial's newer-file flag go, apart from T013's one-time move. Update `composables/__tests__/useTutorial.spec.ts`: finishing gives back the tab's quiz and link, a reload mid-tutorial gives back the tab's quiz, and the practice quiz is never written.

**Checkpoint**: tabs no longer share a quiz or link (quickstart block 1, steps 1 to 5; block 6)

---

## Phase 4: User Story 2 - Get back an unsaved quiz (Priority: P2)

**Goal**: a quiz left by a closed tab, or replaced, is never lost: one comes back by itself, several are offered once, and New and Open stop asking.

**Independent Test**: score part of a quiz in a tab, close it, open the scoresheet in a new tab: the quiz comes back with its answers, names and link. Do it with two tabs closed: both are offered (quickstart "2. Closing and coming back").

### Tests for User Story 2

- [ ] T017 [P] [US2] Extend `composables/__tests__/useScoresheet.spec.ts` with saved status and kept quizzes (research R4, R8; FR-008, FR-009, FR-022): a quiz is saved right after a file save, and unsaved after an edit; undoing or editing by hand back to the saved state makes it saved again; a submitted state counts only while linked to the scheduled quiz it went to, so relinking makes it unsaved; a quiz opened from a file starts saved, and one opened from the meet starts submitted; a quiz started from the schedule whose names a link filled in, with nothing done by hand, is not kept, and after one edit by hand it is; a quiz edited and then undone back to its start is still kept, with its redo steps; a quiz with a saved state is kept unedited.
- [ ] T018 [P] [US2] Add replacing and offering specs in `components/__tests__/` (contracts/client.md "The recent quizzes dialog", "Notices"; research R9; FR-003, FR-010, FR-011, FR-019; spec Story 2 scenarios 1 to 6): New and every Open replace an unsaved sheet without a question, and the replaced quiz is then recent, unsaved and marked offered; a new tab with exactly one unsaved quiz left by a closed tab and no other tab open shows it without a question; with two, or one while another tab is open, it shows the offer form listing them with "Start a blank quiz"; quizzes shown in an offer are not offered again by a later tab, which offers only those left since; saved recent quizzes are never offered; a tab opened by a portal link opens it and shows the "unsaved quizzes from closed tabs" notice with "See them"; a reload never offers. Extend the existing Scoresheet spec helpers rather than copying them.
- [ ] T019 [P] [US2] Extend `persistence/__tests__/autoSave.spec.ts` with the limits (research R10; FR-009): with 81 unsaved and 41 saved recent records, the least recently changed of each kind is deleted; a deleted unsaved quiz's name goes into `dropped`, which is announced once and then cleared; records held by a tab are never deleted; when storage refuses a write, saved recent records are deleted oldest first and unsaved ones never.

### Implementation for User Story 2

- [ ] T020 [US2] Make saved status a comparison in `composables/useScoresheet.ts` (owner: "Canonical quiz file and saved status"; research R4): saved when the canonical current state equals the record's `saved`, or its `submitted` while the link names that submission's meet and scheduled quiz; `unsaved` written with the record. Set `saved` in `saveFile` and `submitted` in `doSubmitToMeet` once the meet stores the quiz, with its meet, scheduled quiz and link, in `components/Scoresheet.vue` (owner: "Setting the saved and submitted states"), and on opening a file or a submission (FR-022). Remove `history.isDirty`'s use, `namesChanged`, `keepNames`, `markSaved`'s old meaning and the dummy step pushed for a restored quiz; `doClearAnswers`'s question asks when the quiz is unsaved. Covered by T017.
- [ ] T021 [US2] Keep only quizzes worth keeping (owner: "Which quizzes are kept"; research R8): the writer in `composables/useScoresheet.ts` deletes the tab's record while it has no `saved` or `submitted`, no undo or redo steps, and its state equals `start`, and writes it again on the next change; New and Open set `start`, and the link routine in `components/Scoresheet.vue` sets it again where `keepNames` is called today (`startScheduled`, `openStored`) when the state still equals `start`. Covered by T017.
- [ ] T022 [US2] Replace without asking (owner: "Replacing without asking"; FR-019): remove `confirmDiscard` and its calls from `newQuiz`, `newFromSchedule`, `openFromSchedule`, `openStoredVersion`, `openFile` and `tryOpenKeptAutoSave` in `components/Scoresheet.vue`; before the new quiz is shown, the tab writes its old record (unless not kept), marks it offered and releases its lock, then begins or claims the new one through the records store. Covered by T018.
- [ ] T023 [US2] Add the recent quizzes dialog's offer form as a new component in `components/` (owner: "Offering, listing, restoring and discarding recent quizzes"; contracts/client.md), following `StoredQuizPickerDialog.vue`'s pattern and naming quizzes with `quizName`; at a tab's start (T014) bring back the one unsaved quiz or show the offer, and mark every record shown offered (research R9); in `components/Scoresheet.vue`'s notice row show the link-tab notice and the dropped-quizzes notice (contracts/client.md "Notices"). Covered by T018.
- [ ] T024 [US2] Apply the limits in the records store in `persistence/autoSave.ts` (owner: "The limits, dropping, and announcing dropped quizzes"; research R10) after a record leaves a tab and at a tab's start, recording dropped unsaved names in `meta` `dropped`, and freeing room from saved recent records when a write is refused. Covered by T019.

**Checkpoint**: closing or replacing never loses a quiz (quickstart block 2)

---

## Phase 5: User Story 3 - Go back to a recent quiz at any time (Priority: P3)

**Goal**: Open ▸ Recent quizzes lists every recent quiz, one row per kept state, to restore or discard offline; Open continues the quiz it came from.

**Independent Test**: with two unsaved and two saved recent quizzes, choose Open, Recent quizzes: all four are listed, the unsaved ones first and marked; restore one, discard another (quickstart "3. Recent quizzes", "5. Open finds its quiz").

### Tests for User Story 3

- [ ] T025 [P] [US3] Extend T018's spec in `components/__tests__/` with the list form (contracts/client.md; FR-012 to FR-016; spec Story 3 scenarios 1 to 8): Open ▸ Recent quizzes… lists every recent quiz, unsaved first, each row with quiz name, teams, number of answers and time; a quiz saved, then submitted after edits, then edited, shows three rows ("Unsaved", "As saved to a file", "As submitted to `<meet>`"), and equal states one row; restoring a row shows that state with the quiz's link, and the tab's own quiz is listed afterwards; restoring an "As submitted" row after the quiz was relinked brings back the link it was sent with, and the quiz shows as saved; Discard asks and removes the whole quiz; Discard all asks and leaves quizzes held by tabs; a quiz another tab claims meanwhile gives the "just opened in another tab" notice with the list still open; none says "No recent quizzes."; a newer version's quiz is listed "From a newer version" and restoring it asks as `TRY_NEWER_PROMPT` does.
- [ ] T026 [P] [US3] Extend `persistence/__tests__/autoSave.spec.ts` and `composables/__tests__/useScoresheet.spec.ts` with Open matching and splitting (research R7; FR-023; data-model.md "Matching an Open", "Positioned behind"): a file equal to a recent quiz's current, saved or submitted state continues that record, with its link; a submitted state matches only an Open from the meet with the same scheduled quiz; of two matches the most recently changed wins; a match held by another tab starts a new record and says so; a file equal to the tab's own quiz opens as a new record, and the tab's old record becomes recent; continuing from the saved state of a quiz edited since puts it at that state with redo up to the old current one; the first edit there first writes the old current state, with its history, other kept states and link, as a new recent record; Clear answers there splits it off the same way; redoing up to it clears `ahead`; restoring a saved row positions the same way; no match starts a new record, as today.

### Implementation for User Story 3

- [ ] T027 [US3] Add Open ▸ Recent quizzes… and the dialog's list form (owner: "Offering, listing, restoring and discarding recent quizzes"; contracts/client.md): rows per kept state, Restore (claim the record, replace as T022 does, position at the row's state, taking the link from a submitted row), Discard and Discard all through `confirmAction` with the contract's wording, the empty text, and the taken notice, in the T023 component and `components/Scoresheet.vue`'s Open menu. Covered by T025.
- [ ] T028 [US3] Continue the quiz Open came from (owner: "Open continuing a recent quiz"): the open path in `components/Scoresheet.vue` (`openJsonQuiz`, `openStored`, the ODS branch of `openFile`) asks the records store in `persistence/autoSave.ts` for a match by canonical state (T004) among records other than the tab's own and claims it, or begins a new record and says why when the only match is held; `composables/useScoresheet.ts` positions the quiz at the matched state with `ahead` and redo as data-model.md describes, and writes `ahead` as its own recent record before an edit, Clear answers or Clear names drops it. Covered by T026.
- [ ] T029 [US3] Make a newer version's quiz a recent record (owner: "A newer version's quiz"; research R15; FR-016): listed and opened through the dialog with `parseForOpen`'s prompt and `parseQuizFileAttempt`, kept until discarded; remove the header notice in `components/Scoresheet.vue`, `keptInPlace`, `autoSavePausedForKept`, `tutorialBlockedByKept` and `refreshKeptNewerAutoSaves` from `persistence/autoSave.ts` and `composables/useScoresheet.ts`, and the tutorial's block on it in `startTutorial`. Covered by T025, T013.

**Checkpoint**: every recent quiz can be found, restored in any kept state, or discarded (quickstart blocks 3 and 5)

---

## Phase 6: User Story 4 - Undo survives a reload and a restore (Priority: P4)

**Goal**: undo and redo step through the same edits after a reload or a restore, and never leave the device.

**Independent Test**: score five answers, reload, undo five times: the answers are removed one by one, newest first. Do the same after the quiz has been replaced and restored from Recent quizzes (quickstart "4. Undo across reload and restore").

### Tests for User Story 4

- [ ] T030 [P] [US4] Extend `composables/__tests__/useScoresheet.spec.ts` and `persistence/__tests__/quizFile.spec.ts` (FR-020, FR-021; SC-007): after the tab's record is written and read back, undo and redo step through the same edits, newest first, and redo still reaches every undone step; a duplicated tab's copy undoes the same steps; a restored recent quiz, and each of its kept states, comes back with the undo steps that led to it; 1001 edits leave the last 1000 undoable and the kept states intact; a saved file and a submission's quiz file carry no undo history.

### Implementation for User Story 4

- [ ] T031 [US4] Store and load undo history with the record (owner: "Writing the tab's quiz, link and history"): the writer in `composables/useScoresheet.ts` writes `current`'s undo and redo steps and the undo steps of `saved` and `submitted` when it sets them (T020), and a tab's start, a restore and an Open match set the history's stacks from the record (T006). Files and submissions keep using `storeToQuizFile` alone. Covered by T030.

**Checkpoint**: all four stories work (quickstart blocks 1 to 6)

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: documentation, release, and the by-hand pass

- [ ] T032 [P] Update `docs/architecture.md` where it describes auto-save (`autoSave.ts`), the meet session's `localStorage` copy, the tutorial's snapshot and the newer-quiz handling, to the records store, the tab's record and lock, recent quizzes and undo as data.
- [ ] T033 [P] Record the feature in `apps/scoresheet/CHANGELOG.md` and bump scoresheet MINOR with the `release` skill, naming the bundled shared version on master at the time; no other package bumps.
- [ ] T034 Run `pnpm test:unit`, `pnpm type-check` and `pnpm lint`, then quickstart.md's by-hand blocks 1 to 6 in Chrome and Firefox, the duplicate-tab and crash checks included.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first; T002 any time.
- **Foundational (Phase 2)**: needs T001. T003, T005, T007 and T009 can start at once. T004 needs T003; T006 needs T005; T008 needs T006 and T007; T010 needs T009.
- **User Story 1 (Phase 3)**: needs Phase 2. T014 needs T011 and T013; T015 needs T012 and T014; T016 needs T015.
- **User Story 2 (Phase 4)**: needs US1 (each tab must have its own record before one can be left). T020 needs T017; T021 needs T020; T022 needs T018 and T021; T023 needs T022; T024 needs T019.
- **User Story 3 (Phase 5)**: needs US2 (the dialog and replacing). T027 needs T025 and T023; T028 needs T026; T029 needs T027.
- **User Story 4 (Phase 6)**: needs Phase 2 and T020 (kept states); restore checks need T027.
- **Polish (Phase 7)**: after the stories that ship.

### Within Each User Story

- A new test is written, and seen to fail, before the implementation it covers
- An owner from plan.md's "Reuse and Ownership" table before the tasks that call it
- Story complete before moving to next priority

### Parallel Opportunities

- T003, T005, T007 and T009 are four different test files; T004, T006 and T010 are three different source files.
- Each story's test tasks are marked [P]: different files, or written while the previous story's implementation finishes.
- Implementation tasks in `Scoresheet.vue` (T020 to T023, T027 to T029) are sequential: one file.

---

## Parallel Example: Foundational

```bash
Task: "T003 canonical quiz file specs in apps/scoresheet/src/persistence/__tests__/quizFile.spec.ts"
Task: "T005 history specs in apps/scoresheet/src/composables/__tests__/useHistory.spec.ts"
Task: "T007 undo-as-data specs in apps/scoresheet/src/composables/__tests__/useScoresheet.spec.ts"
Task: "T009 records store specs in apps/scoresheet/src/persistence/__tests__/autoSave.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 and 2: the store, the canonical state and undo steps as data
2. Phase 3: each tab its own record, link and tutorial safekeeping, with the move from the old keys
3. **STOP and VALIDATE**: quickstart blocks 1 and 6

US1 alone must not ship: it leaves a closed tab's quiz in a record nothing shows (US2 brings it back), so the stories ship together.

### Incremental Delivery

1. Foundational → US1: tabs stop overwriting each other
2. US2: nothing left or replaced is lost; New and Open stop asking
3. US3: every recent quiz can be found and restored; Open continues the quiz it came from
4. US4: undo survives reload and restore
5. One pull request for the feature, unless the maintainer asks to split it (US1 to US3, then US4, is the natural split); each task or story is a commit or a few, and leaves the sheet working

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently

## Phase 8: Convergence

Order: T035 first (every change through `edit`); T036 to T038 build on it. T040 and T041 both change the tab's queue of writes in `composables/useScoresheet.ts`: one after the other. T039 and T042 to T045 are independent. T046 last, then T034.

- [X] T035 Extend `composables/__tests__/useScoresheet.spec.ts` with undo over every change: a team name typed in, an on-time mark, a quizzer moved, a question type, and division, quiz number, consolation and overtime each undo and redo as one step and survive a reload; three such edits undo in turn; a quiz saved, then renamed and scored, restored as saved and redone all the way equals the latest state, names included, and its ahead state is cleared; then, keeping `useTutorial.spec.ts` passing (the tutorial's own setup now adds practice steps, which `finish` replaces), route `setTeamName`, `setQuizzerName`, `toggleOnTime`, `moveQuizzer`, `setQuestionType` and the quiz settings (the `v-model` bindings on division, quiz number, consolation and overtime in `components/Scoresheet.vue`, and the meet warnings' fixes) through `edit` in `composables/useScoresheet.ts` per FR-020, US4/AC4, US4/AC6 (missing)
- [X] T036 Test then make a visit to a typed field one undo step in `composables/useScoresheet.ts` and `components/Scoresheet.vue`: typing "Lions" into a team name and undoing once leaves it as before the visit; leaving the field, or any other edit, ends the step, so a second visit is a second step; Ctrl+Z mid-visit takes back the visit so far; the same for quizzer names, the quiz number and the typed division per FR-020 (missing)
- [X] T037 Test then make Clear answers and Clear names one undo step each in `composables/useScoresheet.ts`, keeping the history: undo after Clear answers brings the answers, no-jumps, timeouts and question types back; undo after Clear names brings the names and, in the session, the meet picks it cleared (as `alongside`, `components/Scoresheet.vue`); review #5's case (open a file, Clear answers, score two answers, restore as saved, redo all) ends on exactly one of the two states; drop "This cannot be undone." from both confirmations, and ask before Clear answers only as today per FR-020, US4/AC5 (contradicts)
- [X] T038 Test then make the sheet's own changes undo steps after the first edit by hand, and none before: `applyLink`, the fills in `assignTeam`, `restoreTeamName`, `restoreQuizzerName` and the roster's name changes in `components/Scoresheet.vue` change a quiz still at its start without a step and take the start again (R8), and add one step each otherwise per FR-020, FR-008 (missing)
- [X] T039 Test (a recent quiz listed, then claimed, edited and let go by another tab, then restored here, shows the other tab's edit) then read the record again after claiming it in `components/RecentQuizzesDialog.vue` `restore`, and in `findMatch` and `lookForLeftBehind` in `persistence/autoSave.ts`, and use that copy; a record gone by then counts as taken per FR-013, FR-008 (contradicts)
- [X] T040 Test (a write in flight, then an edit and New: another tab claiming the old record reads the edit) then let `moveTab` in `persistence/autoSave.ts` release the old record's lock only after the tab's queued writes in `composables/useScoresheet.ts` have settled per FR-019, SC-006 (contradicts)
- [X] T041 Test then report failed writes in `composables/useScoresheet.ts` and `components/Scoresheet.vue`: `writeRecord` false shows "This quiz can't be kept on this device: it is full. Save it to a file."; any other failed write shows "This quiz couldn't be kept on this device. Save it to a file."; each closable, as contracts/client.md's notices table has it; a failed write never stops later ones (the `writing` chain catches), and `splitAhead`'s write is reported the same way per spec edge case "Storage is full", R10 (missing)
- [X] T042 Test (a quiz whose names a link filled in, nothing done by hand, runs the tutorial and gets its names back) then keep the tab's start through the tutorial in `composables/useScoresheet.ts` and `composables/useTutorial.ts`, so `showTabQuiz` gives back the quiz as it was, not the practice sheet's start per FR-018 (contradicts)
- [X] T043 Test (storage failing at Open from a file and from the meet still opens the quiz, as a new one) then catch a `findMatch` failure in `showOpened` in `components/Scoresheet.vue` and open as a new quiz per FR-023, plan "main.ts mounts without storage" (partial)
- [X] T044 Test (a recent quiz written by another tab between this tab's listing and its marking leaves that edit in place) then set `offered` in `lookForLeftBehind` in `persistence/autoSave.ts` by reading and writing the record in one transaction, changing only `offered` per FR-010 (contradicts)
- [X] T045 Test (without Web Locks, Recent quizzes and Discard all leave the tab's own quiz out) then pass `currentTab()?.id` to `listRecent` and `discardAllRecent` in `components/RecentQuizzesDialog.vue` per FR-015 (contradicts)
- [X] T046 Describe undo over every change, a typed field as one step and Clear as a step in `docs/architecture.md`, the 0.25.0 section of `apps/scoresheet/CHANGELOG.md` and a by-hand block in `specs/008-tab-autosaves/quickstart.md` per plan (architecture and CHANGELOG in this PR), T032, T033 (partial)
