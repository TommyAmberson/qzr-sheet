---

description: "Task list for New, Open and Link on the scoresheet"
---

# Tasks: New, Open and Link on the scoresheet

**Input**: Design documents from `/specs/007-open-new-link/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the implementation task names the test task or existing test that covers it. No scoring or validation code changes here, so the principle requires none; the plan (research R13) still has each story's behaviour proved by a test written first.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Everything is in `apps/scoresheet/src/` unless a path says otherwise; tests sit in `__tests__/` beside the code.
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

**Purpose**: Project initialization and basic structure

No tasks: no new dependency, package, route or schema. The worktree has `pnpm install` run. Before T001, tell the `stats` session that work on `apps/scoresheet/src/composables/useMeetSession.ts` and `apps/scoresheet/src/api.ts` has started (research R12).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The scheduled quiz copy in the meet session, and the one link routine every story calls.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T001 [P] Add the two client calls the scoresheet lacks to `apps/scoresheet/src/api.ts` (research R1; contracts/client.md "Server routes read"): the stored quizzes a person may see with their current files (`GET /api/meets/:id/results`), and one stored quiz's versions (`GET /api/meets/:id/results/:resultId/revisions`). Reuse `request`, `QuizFile` and the row shapes the portal already has in `apps/web/src/api.ts` if they can be shared from `@qzr/shared` or `@qzr/ui` without moving code; otherwise type only the fields the scoresheet reads. No test of its own: T007 and T018 exercise them through mocks.
- [X] T002 [P] Write session specs, first and failing, in `apps/scoresheet/src/composables/__tests__/useMeetSession.spec.ts`, extending its existing `getMeetTeams` and `getTeamQuizzers` mocks (data-model.md "Scheduled quiz copy"): linking a scheduled quiz keeps a copy with its label, division, consolation flag, quiz number and each seat's team id or none; the copy is cleared by unlinking the quiz (picks and meet kept), by unlinking the meet, and by starting a new quiz in the meet; a stored session with `quizId` and no copy loads as linked with nothing to compare; a fresh fetch rewrites the copy from the published schedule and marks it as no longer in the schedule when the quiz is gone; a seat whose team id the team list no longer has reads as undecided; a fetch that returns after another quiz was begun writes nothing.
- [X] T003 Keep the scheduled quiz copy in the meet session, owned by `apps/scoresheet/src/composables/useMeetSession.ts` beside `quizId` (plan: "The copy of the linked scheduled quiz", "Fetching the meet's roster, divisions and schedule afresh", "Discarding what the reload fetch brings"): write it on a link to a scheduled quiz, clear it by the rules in data-model.md, add unlinking the scheduled quiz alone, and extend `refresh` to fetch roster, divisions and the scheduled quiz together under the existing race guard and `quizEpoch`. Reuse `applyLoadedQuiz`, `startNewQuiz`, `clearSession`, `persist`, `getScheduledQuiz`. `quizId` keeps its name and meaning (research R7). Covered by T002.
- [X] T004 [P] Write link specs, first and failing, in a new spec beside `apps/scoresheet/src/components/__tests__/openWhileLinked.spec.ts`, reusing that file's API and `fileIO` mocks and roster fixture (move them to a shared helper in the same `__tests__/` folder rather than copying; research R5, FR-013 to FR-016): linking a meet or a scheduled quiz changes no answer, timeout, no-jump mark, typed team name, typed quizzer name, typed division or typed quiz number; an unpicked slot whose typed name names a roster team is picked under the typed name and its blank seats take that team's quizzers; a slot bearing a team the scheduled quiz does not seat is picked as the team typed, never as the schedule's; a pick made against the same meet is kept; linking another meet's quiz keeps names and remakes picks against the new roster; a link to a scheduled quiz sets a blank division, consolation flag and quiz number and fills a blank unpicked slot with that slot's scheduled team; it does not fill when that team is already in another slot, nor for an undecided seat; nothing is picked or filled unless a link is run.
- [X] T005 Grow `onMeetLoaded` in `apps/scoresheet/src/components/Scoresheet.vue` into the one link routine (plan: "What linking does to each slot, division and number"; research R5): it takes what to link (a meet, or a scheduled quiz and its meet)  and per slot keeps a same-meet pick, else picks by typed name with the existing `findMatchingTeam` and `pickMisspeltTeam`, else takes the scheduled seat's team for a blank slot unless that team is on the sheet; a blank division, consolation flag and quiz number take the schedule's. The routine has no modes: every link fills. Reuse `pickTeam`, `teamsFreeFor`, `given`. Nothing else in this feature decides what a link does. Covered by T004.
- [X] T006 Add the waiting state every action that fetches goes through, owned by `apps/scoresheet/src/components/Scoresheet.vue` (plan: "Waiting on the meet"; FR-028): while such an action waits, the sheet shows that it is waiting and takes no scoring, edit, key or menu input, only Cancel; cancelling returns the sheet exactly as it was at once and what arrives afterwards is discarded. It serves New from schedule, both server Opens, links, the refresh symbol and the fetch before the submit question; the reload fetch does not use it. Prove it with a spec in `apps/scoresheet/src/components/__tests__/` on the shared helper from T004, using a fetch held open: input is refused while waiting, Cancel restores sheet, picks and links, and a late answer changes nothing. `ChoiceDialog` from `packages/ui` asks a question and resolves on a choice, so it doesn't fit a wait that ends by itself; follow its look.

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Start the scheduled quiz from a clean sheet (Priority: P1) 🎯 MVP

**Goal**: New from schedule gives a blank quiz that knows which scheduled quiz it is, with division, number and decided teams in place, and nothing of the last quiz.

**Independent Test**: With a quiz scored on the sheet, choose New from schedule and pick another quiz: no answers, the picked quiz's division, number and decided teams, the linked display naming it (quickstart "1. New from schedule").

### Tests for User Story 1

> **NOTE: Where a task adds a new test, write it first and see it fail.**

- [X] T007 [P] [US1] Write New specs in a new spec in `apps/scoresheet/src/components/__tests__/`, on the shared helper from T004 with a `getScheduledQuiz` mock (spec Story 1 scenarios 1 to 7; contracts/client.md "Menus", "Questions asked", "Portal links"): New from schedule on a scored, named sheet leaves no answer, name, timeout or no-jump mark of the old quiz and links the picked quiz and its meet; three decided seats give the schedule's division and number and three picked teams with rosters seated; an undecided seat leaves its slot blank and unpicked; the new quiz has 20 questions whatever the sheet had; declining the unsaved-changes question leaves sheet, picks and links as they were and fetches nothing; a failed fetch says the meet can't be reached and leaves them as they were; a plain New keeps the meet link and clears the scheduled quiz; a quiz with a stored result the person sees asks open, new or cancel, and one they may not see (403 from the list) starts new without asking; `?meetId&quiz` behaves as New from schedule; while the schedule is being fetched the sheet shows it is waiting and takes no scoring, edit or menu action, only Cancel; cancelling leaves sheet, picks and links as they were, and a schedule that arrives after cancelling changes nothing (FR-028).

### Implementation for User Story 1

- [X] T008 [US1] Start a quiz from the schedule in `apps/scoresheet/src/components/Scoresheet.vue` (plan: "Starting a quiz from the schedule", "Asking before replacing the sheet"; research R5, R6): ask about unsaved changes, fetch behind the waiting state (T006), then on success reset to a blank 20-question quiz and run the link routine (T005) for the scheduled quiz. Remove `loadScheduledQuiz`, `computeSeatChange` and anything left without a caller (`hasTypedNames`, `buildSlotFromSeat` if unused). Add "New from schedule…" to the New menu, served by `SchedulePickerDialog.vue`'s existing `onPick`; remove "Load from schedule…". Point the `quiz` branch of `loadFromUrlParams` at it. Reuse `newQuiz`, `resetStore`, `confirmAction`, `isDirty`. Add this story's lines to `apps/scoresheet/CHANGELOG.md` under Unreleased. Covered by T007.
- [X] T009 [US1] Ask before starting a scheduled quiz that already has a stored result, in the same handler in `apps/scoresheet/src/components/Scoresheet.vue` (FR-002; plan: "Which stored quiz a scheduled quiz has"): one lookup matching `resultKey` of the stored quizzes (T001) against the scheduled quiz's `scheduleQuizMeta`, written once where US4 can call it too; offer open it, start a new one, or cancel with the existing `ChoiceDialog`. Until US4 lands, "open it" opens the current file through `openJsonQuiz` and links the scheduled quiz. A 403 or failed list means no question. Covered by T007.

**Checkpoint**: New from schedule works and is the MVP; "Load from schedule" is gone

---

## Phase 4: User Story 2 - Link a quiz already on the sheet without disturbing it (Priority: P2)

**Goal**: A meet or a scheduled quiz can be linked, refreshed and unlinked at any time from one place, changing nothing typed or scored.

**Independent Test**: Score part of a quiz with typed names unlinked, link the scheduled quiz, compare before and after; unlink; reload (quickstart "2. Link without disturbing").

### Tests for User Story 2

- [X] T010 [P] [US2] Write Link menu specs in a new spec in `apps/scoresheet/src/components/__tests__/`, on the shared helper (spec Story 2 scenarios 6 to 10; FR-012, FR-016, FR-017, FR-023, FR-027; contracts/client.md "Menus", "Linked display"): the linked display shows the meet, and the scheduled quiz's label when one is linked, and both survive a remount from storage; Link a scheduled quiz on an unlinked sheet links its meet too; Unlink quiz keeps contents, picks and meet; Unlink meet drops both links and keeps names, answers, division and number; the refresh symbol carries the label "Refetch names from the meet and schedule", fetches afresh and links again, so a slot whose name the roster has since gained is picked and a blank slot is filled; the fetch on mount and the one before the submit question renew the copy and the warnings and make no pick and fill nothing, so a name the roster has since gained stays unpicked until the refresh symbol is pressed; submitting shows the waiting state while it fetches before its question; no fetch is made when a name is edited; a link or refresh in progress shows the same waiting state with Cancel as the only action; a failed link or refresh says the meet can't be reached and changes nothing; the fetch on mount never blocks scoring, says nothing when it fails, and is discarded when another quiz was started meanwhile; New, Clear names, Open from file and both unlinks make no request.

### Implementation for User Story 2

- [X] T011 [US2] Build the Link menu and linked display in `apps/scoresheet/src/components/Scoresheet.vue` (plan: "The linked display, the Link menu and the refresh symbol"; research R9; contracts/client.md): grow the session pill to show the meet and the scheduled quiz and open a menu with Link a meet…, Link a scheduled quiz…, Unlink quiz, Unlink meet; add the refresh symbol beside it with its tooltip and accessible label; remove "Load teams from meet…" and "Unlink meet" from the New menu. Each link item runs the link routine (T005); the symbol runs `refresh` (T003) then the routine for what is linked. Both wait behind the waiting state (T006). Reuse `MeetPickerDialog.vue`, `SchedulePickerDialog.vue`, the file-menu dropdown markup, `doUnlinkMeet`. Add this story's lines to `apps/scoresheet/CHANGELOG.md` under Unreleased. Covered by T010.
- [X] T012 [US2] Make the sheet's own fetches follow FR-023 in `apps/scoresheet/src/components/Scoresheet.vue`: on mount, and in `doSubmitToMeet` once before `submitConcerns` when the target is the linked meet, run `refresh` alone, with no link call: the copy and warnings are renewed, nothing is picked or filled. The submit fetch waits behind the waiting state (T006); the one on mount runs behind the sheet. A failure leaves the copy held and interrupts nothing. Covered by T010.

**Checkpoint**: Stories 1 and 2 work; every link goes through one routine

---

## Phase 5: User Story 3 - See where the quiz differs from the schedule (Priority: P3)

**Goal**: While a scheduled quiz is linked, differences in division, number and each slot's team are warnings with a one-step fix, the team fix moving a whole team when it is elsewhere on the sheet.

**Independent Test**: Link a scheduled quiz to a sheet whose number and one team differ; both are counted, each names the schedule's value, taking it clears the warning, and submitting asks about what is left (quickstart "3. Schedule warnings and fixes").

### Tests for User Story 3

- [X] T013 [P] [US3] Write store and scoresheet specs for two teams changing places, in `apps/scoresheet/src/stores/__tests__/` and `apps/scoresheet/src/composables/__tests__/useScoresheet.spec.ts`, on their existing fixtures (research R4; FR-021): after the change each team's name, quizzers in seat order, answers, timeouts and on-time mark are in the other's slot, every team's score is what it was, the third team is untouched, and one undo restores the order and one redo repeats it.
- [X] T014 [P] [US3] Write schedule warning specs in a new spec in `apps/scoresheet/src/components/__tests__/`, on the shared helper (spec Story 3 scenarios 1 to 8; FR-019 to FR-022, FR-024; contracts/client.md "Warning lines added"): each line of the contract's table appears for its case with the wording given there, including a consolation difference reported with the division, a blank slot where the schedule seats a team, and a quiz no longer in the schedule; an undecided seat and a sheet with no scheduled quiz linked give none; the lines are counted with the roster warnings and appear in the submit question when the target is the linked meet, which still sends on confirm; taking a division or number fix sets it and clears the line; taking a team fix swaps the two teams and their picks when the scheduled team is in another slot, clearing both lines with scores unchanged; when it is not on the sheet it replaces the slot's team name and pick and leaves typed quizzer names; a team move or replacement is one undo, and a division or number fix is a plain edit; a blank slot the schedule seats shows the schedule's line and not the roster's "no team picked" as well; each fix's label says in words what it will do.

### Implementation for User Story 3

- [X] T015 [US3] Let two teams change places (plan: "Two teams changing places"; research R4): one action in `apps/scoresheet/src/stores/quizStore.ts` swapping their `seatOrder`, wrapped with one history entry in `apps/scoresheet/src/composables/useScoresheet.ts`, and the same two slots' picks swapped in `apps/scoresheet/src/composables/useMeetSession.ts`, following `moveQuizzer` and `reorderSlotQuizzers`. Nothing is copied between teams. Covered by T013.
- [X] T016 [US3] Add schedule lines and fixes to the one warning list, owned by `meetWarnings` in `apps/scoresheet/src/components/Scoresheet.vue` (plan: "The warning list", "Taking a schedule's value"; research R8): entries carry their line and, where the contract gives one, a fix; schedule lines come from the session's scheduled quiz copy (T003), compared slot by slot with the same name matching the roster uses; the submit question and `warningList` read the same entries as text. A team fix is T015's swap or `pickTeam` for a team not on the sheet; division, consolation and number fixes set the quiz's fields. Reuse `teamNameIssue`, `teamNameIssueLine`, `given`, `lacksDivision`. Add this story's lines to `apps/scoresheet/CHANGELOG.md` under Unreleased. Covered by T014.
- [X] T017 [US3] Show the warnings with their fixes in one new dialog component in `apps/scoresheet/src/components/`, opened by the warning count in `Scoresheet.vue` in place of `showMeetWarnings`'s `alert` (plan: "Showing the warnings with their fixes"; research R8): every entry as a line, a fixable one with a button labelled by what it will do, as in contracts/client.md. Follow `ChoiceDialog.vue`'s look and dialog pattern from `packages/ui`; it can't be used as is because it asks one question with one row of choices. The count keeps its accessible label and gives up focus when the dialog closes. Covered by T014.

**Checkpoint**: A linked quiz that differs from its scheduled quiz says so, and can be put right in one step

---

## Phase 6: User Story 4 - Open a quiz the meet already has (Priority: P4)

**Goal**: A stored quiz opens from the meet or the schedule, at its current version or an earlier one, linked as if opened from a file and then linked.

**Independent Test**: Send a quiz, start a new one, Open from the meet and pick it: its names and answers, teams picked where the roster has them (quickstart "4. Open from the meet and the schedule").

### Tests for User Story 4

- [X] T018 [P] [US4] Write Open specs in a new spec in `apps/scoresheet/src/components/__tests__/`, on the shared helper with mocks for the two calls from T001 and `getRevision` (spec Story 4 scenarios 1 to 9; FR-005 to FR-011, FR-025; contracts/client.md): Open from the meet lists the stored quizzes by quiz name and opens the picked one's current file with no further question; the result equals opening that file and then linking the meet (same picks, same warnings), and is linked to its scheduled quiz when one has the same division, consolation flag and number; an earlier version can be chosen from the same row and opens linked the same way; Open from the schedule opens the stored quiz of the picked scheduled quiz linked to it, and with nothing stored says so and offers to start it new; a 403 from the list, under Open from the meet, says the person may not see the meet's stored quizzes and leaves the sheet as it was, and under Open from the schedule offers to start the quiz as when nothing is stored; declining the unsaved-changes question, or a failed fetch, leaves sheet, picks and both links as they were; opening a file while linked leaves the sheet linked to no meet and no scheduled quiz, with no picks and no warnings, and makes no request; `?meetId&result&revision` opens that version as Open from the meet does; while a stored quiz or the list is being fetched the sheet takes nothing but Cancel, and what arrives after cancelling is discarded (FR-028).

### Implementation for User Story 4

- [X] T019 [P] [US4] Add the stored quiz picker as one new dialog component in `apps/scoresheet/src/components/` (plan: "Listing stored quizzes and their versions"; research R10): the list from T001 by `quizName`, each row opening its current version, with its earlier versions fetched and listed on demand. Follow `SchedulePickerDialog.vue`'s pattern (meet choice, loading and refusal states, a pick callback); it can't be reused because its rows are scheduled quizzes. Covered by T018.
- [X] T020 [US4] Open from the meet and from the schedule in `apps/scoresheet/src/components/Scoresheet.vue` (plan: "Opening a saved quiz from any source", "Asking before replacing the sheet"; research R5, R6): an Open menu with From file…, From the meet…, From the schedule…; ask, fetch, then on success open through `openJsonQuiz` and run the link routine (T005) for the meet, and for the scheduled quiz found by T009's lookup. Open from the schedule with nothing stored offers New from schedule (T008). Replace `loadStoredQuiz` with this path for `?meetId&result&revision`. A file open ends the meet session in `openJsonQuiz` (`clearSession`), and `dropPicks` with its three call sites is removed. Replace `openWhileLinked.spec.ts` with cases in the new Open spec for the new rule: opening a file unlinks. All three waits sit behind the waiting state (T006). T009's "open it" now uses this path. Add this story's lines to `apps/scoresheet/CHANGELOG.md` under Unreleased. Covered by T018.

**Checkpoint**: All four stories work; New, Open and Link each do one thing

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, release and end-to-end checking

- [X] T021 [P] Update `docs/meet-link.md`: what linking does and never does, picks as remakeable ties, New from schedule and the two server Opens as "then link", that the sheet makes no pick unasked and that opening a file unlinks (replacing "opening a file drops picks"), the waiting state, the refresh symbol and when the sheet fetches by itself, the schedule warning lines and their fixes, and the removed "Load" items. Update `docs/architecture.md` where it describes loading a quiz from the schedule. Check `apps/scoresheet/src/tutorial/tutorialSteps.ts` for a step that names a removed menu item.
- [X] T022 Release the scoresheet with the repo's `release` skill: scoresheet MINOR, turning the Unreleased entries the stories wrote into the dated section, with the `### Bundled contract` line for the shared version on master at that time. `packages/shared`, `api` and `web` are not bumped.
- [X] T023 Run `pnpm test:unit`, `pnpm type-check` and `pnpm lint`, then the by-hand checks in `specs/007-open-new-link/quickstart.md` in a browser against a copied local database, and record what could not be checked (a real send, a meet with elimination seats decided).
- [ ] T024 When the pull request is opened (ask the maintainer first), its body closes #170 and names #171, #173 and #16 as the follow-ups the spec leaves; tell the `stats` session the branch is up.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: T001, T002 and T004 can start at once. T003 needs T002; T005 needs T003 and T004; T006 needs T004's shared helper.
- **User Story 1 (Phase 3)**: needs Phase 2. T009 needs T008 and T001.
- **User Story 2 (Phase 4)**: needs Phase 2. Independent of US1 in behaviour; both edit the menus in `Scoresheet.vue`, so they run in order.
- **User Story 3 (Phase 5)**: needs Phase 2, and a way to link a scheduled quiz to be checked by hand (US1 or US2). T015 needs T013; T016 needs T014 and T015; T017 needs T016.
- **User Story 4 (Phase 6)**: needs Phase 2, T008 (New from schedule, offered when nothing is stored) and T009 (the lookup).
- **Polish (Phase 7)**: after the stories that ship.

### Within Each User Story

- A new test is written, and seen to fail, before the implementation it covers
- An owner from plan.md's "Reuse and Ownership" table before the tasks that call it
- Story complete before moving to next priority

### Parallel Opportunities

- T001, T002 and T004 touch three different files.
- Each story's test task ([P]) can be written while the previous story's implementation is finished, since each is a new spec file.
- T013 and T014 are different files; T019 is a new component, independent of T020 until it is wired in.
- Implementation tasks in `Scoresheet.vue` (T005, T008, T009, T011, T012, T016, T020) are sequential: one file.

---

## Parallel Example: Foundational

```bash
Task: "T001 client calls in apps/scoresheet/src/api.ts"
Task: "T002 session specs in apps/scoresheet/src/composables/__tests__/useMeetSession.spec.ts"
Task: "T004 link specs in apps/scoresheet/src/components/__tests__/"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 2: the scheduled quiz copy and the link routine
2. Phase 3: New from schedule, and "Load from schedule" removed
3. **STOP and VALIDATE**: quickstart "1. New from schedule"

### Incremental Delivery

1. Foundational → US1: the common path is right, and can no longer carry scores into the next quiz
2. US2: a quiz can be linked late, refreshed and unlinked
3. US3: the link starts warning, with fixes
4. US4: stored quizzes open from the scoresheet
5. One pull request for the feature, unless the maintainer asks to split it; each story is a commit or a few, and leaves the sheet working

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Done tasks name code as it was when they were written; later renames (the link routine is `planLink` and `applyLink`) and the review rounds' fixes are in the commits, not here
