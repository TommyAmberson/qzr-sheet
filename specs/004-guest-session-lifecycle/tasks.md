---

description: "Task list for the guest session lifecycle"
---

# Tasks: Guest session lifecycle

**Input**: Design documents from `specs/004-guest-session-lifecycle/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Follow the constitution's testing principle. Where it calls for a test, the implementation task names the test task or existing test that covers it.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- pnpm monorepo: `packages/api/src/`, `packages/ui/src/`, `apps/scoresheet/src/`, `apps/web/src/`, as plan.md's Project Structure lists.
- The guest session module lives in `packages/ui/src/guestSession.ts`; its specs stay in `apps/scoresheet/src/composables/__tests__/guestSession.spec.ts`.

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

No tasks: no new dependency, package, or schema. The worktree already has `pnpm install` run.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The token and session shape every story builds on: which guest tokens are current, the room a join returns, and what a guest session keeps.

**⚠️ CRITICAL**: No user story work can begin until the foundation it needs is complete. The server foundation (T001 to T003) comes first and is all PR 1 needs; the client foundation (T004, T005) blocks the PR 2 stories.

- [X] T001 [P] Write API specs, first and failing, for guest token currency (research R1, R2; contracts/api.md "Guest tokens on every route"): in `packages/api/src/routes/__tests__/routeMountOrder.spec.ts`, extend the "guest can read teams" cases so that an official token issued before its room's code was rotated, an official token for a deleted room, a viewer token issued before the meet's viewer code changed, and a token with no `codeTag` all get the same answer as no token (401), while current viewer and official tokens still read; in `packages/api/src/routes/__tests__/results.spec.ts` "revoking official tokens", change the expectation for a rotated or untagged official token from 403 "Rejoin with your room code" to 401; in `packages/api/src/lib/__tests__/jwt.spec.ts`, a viewer code's tag differs from a room code hash's tag for the same string, and the tag changes when the code does. Reuse the existing `signGuestJwt` fixtures in those files.
- [X] T002 Implement guest token currency, decided by one function in `packages/api/src/lib/jwt.ts` (beside the tag it checks) that `sessionMiddleware` in `packages/api/src/middleware/session.ts` calls once per request: after `verifyGuestJwt`, compare the token's `codeTag` with the current code of what it was issued for (the meet's `viewerCode` for a viewer token; the room's `codeHash`, with the room in the token's meet, for an official token), and leave `c.var.guest` null when it doesn't match or the tag is missing. Generalize `roomCodeTag` in `packages/api/src/lib/jwt.ts` to tag either kind, each with its own prefix, rather than adding a second function; viewer tokens issued by `join.post('/guest')` in `packages/api/src/routes/join.ts` carry the tag. Drop the now-redundant tag comparison from `isOfficialOfRoom` and `officialRoomsOf` in `packages/api/src/lib/permissions.ts` (they compare the token's room only) and the guest "Rejoin with your room code" branch of `officialRefusal` in `packages/api/src/routes/results.ts`, which can no longer be reached (since then `officialRefusal` was inlined into `POST /results`, and the tag function is `codeTagFor`). Covered by T001.
- [X] T003 [P] Return the room from the guest join (research R3; contracts/api.md "POST /api/join/guest"): for a room code, `join.post('/guest')` in `packages/api/src/routes/join.ts` adds `room: { id, name }` to its answer and keeps `label`. Add the case to `packages/api/src/routes/__tests__/join.spec.ts` first (room code answer has `room` with the room's id and name and still has `label`; viewer code answer has no `room`).
- [ ] T004 Change what a guest session keeps, owned by `guestSession.ts` (`GuestSessionData`, `joinByCode`, `loadFromStorage`) in `packages/ui/src/guestSession.ts` (research R4; data-model.md "Guest session"): an official session keeps `room` (`{ id, name }` from the join answer) and "**never**" a `code`; a viewer session keeps its `code` as today. Loading the stored state removes `code` from official sessions saved by earlier releases and keeps the rest; a session without `room` falls back to its role. Widen each app's `GuestJoin` answer type to include the optional `room` (`apps/scoresheet/src/api.ts`, `apps/web/src/api.ts` `joinMeetGuest`). Extend `apps/scoresheet/src/composables/__tests__/guestSession.spec.ts` "joinByCode — typed-in form" first: an official join stores `room` and no `code`; a viewer join stores its `code`; an old official session with a `code` loads without it, and the cleaned state is written back to `localStorage` at once (the test reads storage, not only the in-memory state), so no copy of the code survives the upgrade (SC-003). (Delivers User Story 4.)
- [ ] T005 [P] Add the room-code dialog as one component in `packages/ui/src/`, following `ChoiceDialog.vue`'s look, exported from `packages/ui/src/index.ts` (Reuse and Ownership: "The room-code dialog"; contracts/client.md "Dialogs both apps show"): one or more rows, each naming a meet and room with a code field and a per-row message, plus the buttons its caller asks for. Renewal (T008) uses one row and Cancel; the sign-in upgrade (T012) uses one row per room, Skip per row, and Done. `ChoiceDialog` didn't fit because it offers fixed choices, not code fields. Add a component spec beside `apps/scoresheet/src/components/__tests__/ChoiceDialog.spec.ts`, first: rows and their names render, a row shows its message, each button resolves with the codes entered or the rows skipped.

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Keep working after the room code changed or the session ran out (Priority: P1) 🎯 MVP

**Goal**: A refused or expired guest session is renewed instead of ending in an error: viewers silently, officials through one dialog, with the action retried and the quiz untouched.

**Independent Test**: Join as a guest official, rotate the room's code, submit: the app asks for the code, and after the new code the quiz is stored (quickstart scenarios 1 to 4, 11).

### Tests for User Story 1

> **NOTE: Where a task adds a new test, write it first and see it fail.**

- [ ] T006 [P] [US1] Write guest session specs for renewal in `apps/scoresheet/src/composables/__tests__/guestSession.spec.ts`, extending its existing join stubs: a request carrying a viewer token that is known to have expired re-joins from the kept code before sending; a request refused with 401 while carrying a viewer token re-joins and is retried once; a re-join the server rejects, or that answers for a different meet, removes the session and reports it; a network failure is never treated as a refusal. For officials: an action whose session is known to have expired asks for the code before running; an action refused because the session isn't accepted (401) asks for the code, re-joins, and runs once more with the same arguments; Cancel leaves it unrun; a wrong code, a code for another meet, or a viewer code is reported in the dialog without running the action and without storing or replacing any session; while an account is signed in, no renewal is asked for.

### Implementation for User Story 1

- [ ] T007 [US1] Renew viewer sessions inside `withGuestToken` in `packages/ui/src/guestSession.ts` (research R5), reusing `tokenIsFresh`, `joinByCode`, and `addJoinedSession`: re-join before a request when a viewer token is known to have expired; on a 401 for a request that carried a viewer token, re-join and retry once; when the server rejects the re-join, or it answers for a different meet (a changed viewer code since taken by another meet), store nothing for it, remove the session and report that its code is no longer valid through the guest notice (Reuse and Ownership: "Telling the user a guest session or link no longer works"): one notice in `guestSession.ts` that `apps/scoresheet/src/App.vue` and `apps/web/src/App.vue` each show (FR-006, FR-007). `withGuestToken` gets each app's join call where it is created in `apps/scoresheet/src/api.ts` and `apps/web/src/api.ts`. Covered by T006.
- [ ] T008 [US1] Add official renewal around an action, owned by one new helper in `packages/ui/src/guestSession.ts` (Reuse and Ownership: "Renewing an official session around an action"), showing the room-code dialog (T005) with one row and Cancel. For a meet the guest joined as an official, and only while no account is signed in, the helper asks for the code first when the session is known to have expired (FR-002); when the action is refused because the session isn't accepted, it asks, re-joins, and runs the action once more (FR-001, FR-003); Cancel leaves the action unrun (FR-005). The re-join calls the app's join call and stores the answer as a session, the way `joinByCode` does, only when it is an official session for the same meet; a wrong code, a code for another meet, or a viewer code is reported on the row and nothing is stored or replaced (FR-004). Export the helper from `packages/ui/src/index.ts`. Covered by T006.
- [ ] T009 [P] [US1] Run the scoresheet's Submit to meet through the official renewal helper in `apps/scoresheet/src/components/Scoresheet.vue` (`chooseMeet`, `doSubmitToMeet`): a sender lookup returning no access for a meet the guest joined as an official is a refused session, so the "your room code has expired" alert gives way to the dialog; the retry keeps the choice already made about an existing quiz. Extend `apps/scoresheet/src/composables/__tests__/useSubmitToMeet.spec.ts` or `apps/scoresheet/src/components/__tests__/openStoredQuiz.spec.ts`, whichever already stubs the submit path, for: refused, then code entered, then stored, with the sent `roomId` the sender's room (FR-020).
- [ ] T010 [P] [US1] Run the portal's upload, merge (`apps/web/src/views/ResultsView.vue`), quick-form correction, and restore (`apps/web/src/views/ResultView.vue`) through the official renewal helper, so a guest official whose code was rotated is asked for it there too. The Results page's own sender lookup treats a refused guest official session the same way. Extend `apps/web/src/__tests__/sendQuizzes.spec.ts` for an upload refused, then renewed, still sending the room `chooseRoom` returned (FR-020).

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Signing in upgrades the account (Priority: P1)

**Goal**: Signing in folds the guest account into the real one, by code: viewer sessions automatically, official sessions through one dialog.

**Independent Test**: Join one meet as a guest viewer and one with a room code, sign in: the viewer meet is a membership at once; the room is added after its code is entered in the dialog (quickstart scenario 7).

### Tests for User Story 2

- [ ] T011 [P] [US2] Write guest session specs for the upgrade in `apps/scoresheet/src/composables/__tests__/guestSession.spec.ts`: with a signed-in account, each viewer session is redeemed through the app's join call with its kept code and removed; official sessions are passed together to the dialog, a code entered for a row is redeemed and its session removed, a skipped row's session is removed, a wrong code is reported on its row; a network failure keeps the session for a later run (FR-014); an "already a member" answer still removes the session; a guest token is never sent as the code (FR-013).

### Implementation for User Story 2

- [ ] T012 [US2] Add the sign-in upgrade, owned by one new function in `packages/ui/src/guestSession.ts` (research R6), showing the room-code dialog (T005) with one row per guest official session, Skip per row, and Done (contracts/client.md; FR-012: "one dialog right after sign-in, listing each guest room by meet and room name with a code field and Skip per row, and Done"); no second dialog component. The function takes the app's existing signed-in join call (`joinMeet`, `POST /api/join`); it never adds a route or sends a token. Export from `packages/ui/src/index.ts`. Covered by T011.
- [ ] T013 [P] [US2] Wire the upgrade into the scoresheet: run it when an account session appears and on start when already signed in with guest sessions (`apps/scoresheet/src/App.vue` or `components/SignInWidget.vue`, where `useAuth`'s session is watched), with the dialog mounted once; refresh the meet list and submit targets afterwards (`useMeetList`, `useSubmitToMeet.refreshTargets`). Covered by T011 and quickstart scenario 7.
- [ ] T014 [P] [US2] Wire the upgrade into the portal the same way (`apps/web/src/App.vue` or `components/AppHeader.vue`), refreshing the home page's memberships afterwards (`apps/web/src/views/HomeView.vue`). Covered by T011 and quickstart scenario 7.

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - The official sees which room they send for (Priority: P2)

**Goal**: A guest official sees their room before sending, and a send is accepted only for that room.

**Independent Test**: Join with a room's code: the meet picker names the room and the Submit step names it; a send naming another room is refused (quickstart scenarios 6, 10).

- [X] T015 [P] [US3] Refuse a guest send that names another room, in `POST /results` in `packages/api/src/routes/results.ts` (contracts/api.md): a guest official's `roomId` other than its token's room gets 403 "Not an official of this room"; no `roomId` uses the token's room, unchanged (FR-020, FR-021). Add both cases to `packages/api/src/routes/__tests__/results.spec.ts` "POST /api/meets/:id/results" first.
- [ ] T016 [P] [US3] Show the room in the scoresheet (FR-019): the meet picker's guest official rows show the session's `room` name, from `useMeetList` in `apps/scoresheet/src/composables/useMeetList.ts` and `components/MeetPickerDialog.vue`, falling back to the role when an older session has none; the Submit step in `components/Scoresheet.vue` names the room the quiz goes to even when `chooseRoom` picks the only room silently (for example in the confirmation that it was stored). Extend `apps/scoresheet/src/components/__tests__/MeetPickerDialog.spec.ts` for the room label.

**Checkpoint**: All user stories so far should be independently functional

---

## Phase 6: User Story 4 - Room codes are not kept on the device (Priority: P2)

**Goal**: No room code stays on the device after joining, in either app; viewer codes still do.

**Independent Test**: After joining with a room code in each app, `qzr-guest-session` holds the official session's `room` and no `code`; an old session's `code` is gone after a reload (quickstart scenario 5).

No further tasks: T004 delivers it, since both apps join through `joinByCode` in the shared module (the scoresheet's "Have a code?" form and the portal's `HomeView.vue`).

---

## Phase 7: User Story 5 - Ending a guest session (Priority: P2)

**Goal**: Signing out in either app ends the guest account and its cached meet data; a guest can leave one meet from either app; the portal home lists the guest account's meets.

**Independent Test**: With guest sessions, sign out in the portal: neither app lists a guest meet and the two caches are gone; leave one of two meets from each app: only that one goes, the scores stay (quickstart scenario 8).

### Tests for User Story 5

- [ ] T017 [P] [US5] Write guest session specs in `apps/scoresheet/src/composables/__tests__/guestSession.spec.ts`, extending "persistence": the sign-out clear removes every guest session and the `qzr-team-names` and `qzr-submit-meet` entries and leaves other keys; leaving a meet removes only that session and clears `active` if it pointed there. Adjust `apps/scoresheet/src/composables/__tests__/useTeamNames.spec.ts` and `useSubmitToMeet.spec.ts` if they name the keys directly.

### Implementation for User Story 5

- [ ] T018 [US5] Add the sign-out clear and leaving one meet, owned by `packages/ui/src/guestSession.ts` (research R7, R8): one function clears the guest account and the device data listed in data-model.md "Device data cleared on sign-out", owning those storage keys; the keys move from `apps/scoresheet/src/composables/useTeamNames.ts` and `useSubmitToMeet.ts`, which read them from `@qzr/ui` (and their in-memory copies reset when cleared); leaving is a setter beside `setActiveSession`, reusing `persist`. Covered by T017.
- [ ] T019 [P] [US5] Wire it into the scoresheet: `doSignOut` in `apps/scoresheet/src/components/SignInWidget.vue` calls the sign-out clear; the meet picker (`components/MeetPickerDialog.vue`, `composables/useMeetList.ts`) shows Leave on guest rows and refreshes after. Leaving never touches the quiz or auto-save (FR-024). Extend `apps/scoresheet/src/components/__tests__/MeetPickerDialog.spec.ts` for Leave.
- [ ] T020 [P] [US5] Wire it into the portal: the sign-out in `apps/web/src/components/AppHeader.vue` calls the sign-out clear; `apps/web/src/views/HomeView.vue` lists the guest account's meets (name, role, and room for an official) the way it lists memberships, an official's linking to its results (`meet-results`), a viewer's without a link (FR-023), each with Leave; a guest viewer joining from the home page stays on the home page with the meet listed, instead of being sent to a page the router refuses. Covered by quickstart scenario 8.

**Checkpoint**: All user stories so far should be independently functional

---

## Phase 8: User Story 6 - Meet links (Priority: P3)

**Goal**: A viewer link's code leaves the address bar after use, and a meet id in a portal link is never read as a viewer code.

**Independent Test**: Open `?meet=<viewer code>`: joined, address cleaned; with the API down, the code stays; a portal quiz link opens its quiz without a guest join; an old `?meet=<id>&result=…` link still works (quickstart scenario 9).

- [ ] T021 [P] [US6] Name the meet in `meetId` in the portal's scoresheet links: `scoresheetHref` in `apps/web/src/views/ResultView.vue` and the quiz-cell link in `apps/web/src/views/ScheduleView.vue` (research R9; contracts/client.md "Scoresheet links").
- [ ] T022 [US6] Read the new links in the scoresheet: `loadFromUrlParams` in `apps/scoresheet/src/components/Scoresheet.vue` reads `meetId`, and still accepts `meet` together with `quiz` or `result` (FR-027); `doInitGuestSession` in `packages/ui/src/guestSession.ts` reads `meet` as a viewer code only when neither `quiz` nor `result` is present and the value isn't digits only, removes `meet` from the address with `history.replaceState` after the join succeeds or the server rejects the code (the join call returns null), and leaves it when the join call throws (FR-025); a rejected link is reported through the guest notice added in T007 (FR-026). Extend `apps/scoresheet/src/composables/__tests__/guestSession.spec.ts` "initGuestSession — URL parsing" (digits-only value and quiz links skipped; address cleaned on success and on rejection, kept on a network error) and `apps/scoresheet/src/components/__tests__/openStoredQuiz.spec.ts` (`meetId` link, legacy `meet` link) first.

**Checkpoint**: All user stories should now be independently functional

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T023 [P] In each pull request, amend `docs/roles-and-access.md` and `docs/auth.md` for what that pull request delivers (PR 1: revocation for reads and viewers, viewer tags, the join's room, the send rule; PR 2: the rest), covering in all what this feature adds (FR-028; research R10): the guest account and the sign-in upgrade by code (a guest token is never redeemable); revoked tokens granting nothing, reads included, for officials and viewers, with viewer tokens tagged; clients keeping no admin, coach, or room codes; signing out ending guest sessions; leaving a meet; the guest join returning the room; meet links carrying only the viewer code and `meetId` for quiz links. Describe behaviour, not past weaknesses.
- [ ] T024 Release in the pull request that changes each package: api MINOR in PR 1; scoresheet MINOR and web MINOR in PR 2, each with a dated changelog section naming the bundled shared version under `### Bundled contract` (shared itself unchanged), via `pnpm bump`; run `tools/check-contract-versions.sh --pr origin/master`.
- [ ] T025 In each pull request, run `pnpm test:unit`, `pnpm type-check`, `pnpm lint`, `pnpm exec dprint check`, and `typos`, then quickstart.md's scenarios on the local stack (`pnpm dev:all` with a local D1) for what the pull request delivers: PR 1 runs scenario 3 (revoked tokens refused, sending the tokens by hand) and scenario 10 (sends from released apps, and the other-room refusal); PR 2 runs the rest.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: nothing to do.
- **Foundational (Phase 2)**: T001 before T002; T003, T004, and T005 independent of them. The server foundation (T001 to T003, PR 1) blocks T015; the client foundation (T004, T005, PR 2) blocks the PR 2 stories (US1, US2, US5, US6, and T016).
- **User Stories (Phase 3+)**: all depend on Foundational.
- **Polish (Final Phase)**: after the stories it documents and releases.

### User Story Dependencies

- **US1 (P1)**: after Foundational. T006 before T007 and T008; T008 before T009 and T010.
- **US2 (P1)**: after Foundational (needs T004's `room` and T005's dialog). Independent of US1. T011 before T012; T012 before T013 and T014. T013 and T019 both edit `SignInWidget.vue`: do them one after the other.
- **US3 (P2)**: split across the pull requests. T015 (server send rule) after T001 to T003, in PR 1; T016 (room shown in the scoresheet) after T004, in PR 2. Independent of US1 and US2.
- **US4 (P2)**: delivered by T004.
- **US5 (P2)**: after Foundational. T017 before T018; T018 before T019 and T020. T020 shares `HomeView.vue` with T014: do them one after the other.
- **US6 (P3)**: after Foundational. T021 and T022 independent of the other stories; T022 touches `guestSession.ts` and `Scoresheet.vue`, also touched by US1 and US5 tasks, so sequence it after them.

### Within Each User Story

- A new test is written, and seen to fail, before the implementation it covers
- An owner from plan.md's "Reuse and Ownership" table before the tasks that call it
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- Foundational: T001 and T003 together in PR 1; T004 and T005 together in PR 2.
- US1: T009 (scoresheet) and T010 (portal) together after T008.
- US2: T013 (scoresheet) and T014 (portal) together after T012.
- US3: T015 (API, PR 1) and T016 (scoresheet, PR 2) each run within their own pull request.
- US5: T019 (scoresheet) and T020 (portal) together after T018.
- US6: T021 (portal) alongside other stories.

---

## Parallel Example: User Story 1

```bash
# After T008 (the renewal helper in packages/ui):
Task: "T009 Run the scoresheet's Submit to meet through the official renewal helper in apps/scoresheet/src/components/Scoresheet.vue"
Task: "T010 Run the portal's upload, merge, correction and restore through the official renewal helper in apps/web/src/views/ResultsView.vue and ResultView.vue"
```

---

## Implementation Strategy

### MVP First

1. **PR 1 is the first increment**: the server foundation (T001 to T003) and T015, then its share
   of T023 to T025. **STOP and VALIDATE**: quickstart scenarios 3 and 10.
2. **PR 2's smallest slice**: the client foundation (T004, T005) and User Story 1 (T006 to T010).
   **STOP and VALIDATE**: quickstart scenarios 1, 2, 4, and 11. Then the remaining PR 2 stories.

### Delivery: two pull requests (research R11)

Progress: PR 1's tasks (T001 to T003, T015) are done, and its share of T023 to T025 (docs, the api
release, the checks); T023 to T025 stay unchecked until PR 2 does its share.

1. **PR 1, server and revocation** (`api` only): T001, T002, T003, T015, then T023, T024, and T025
   for what it delivers. Revoked tokens grant nothing, viewer tokens are tagged, the guest join
   returns the room, and a guest send for another room is refused. Ships first, since it closes
   access gaps without waiting for client work.
2. **PR 2, client lifecycle** (`packages/ui`, scoresheet, portal): T004 to T014, T016 to T022,
   then T023, T024, and T025 for the rest. Branches from master after PR 1 merges.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Public repo: commit messages and the PR describe behaviour, not the weaknesses this closes
