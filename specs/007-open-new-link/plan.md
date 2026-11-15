# Implementation Plan: New, Open and Link on the scoresheet

**Branch**: `feat/open-new-link` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-open-new-link/spec.md`

## Summary

Untangle the scoresheet's three ways of meeting a meet. New replaces the sheet with a blank quiz,
optionally started from a scheduled quiz. Open replaces it with a saved quiz, from a file, the
meet's stored quizzes or the schedule. Link ties what is on the sheet to a meet or a scheduled quiz
and changes nothing typed or scored. While a scheduled quiz is linked, the sheet warns where the
quiz differs from it and offers the schedule's value as a one-step fix, including moving a whole
team to its scheduled slot.

Technically it is one routine and one small piece of state. Linking becomes a single routine
([research R5](./research.md)) that every other action reuses: New from schedule is New then link,
Open from the meet is open then link, the refresh symbol is link again. The meet session keeps a
copy of the linked scheduled quiz for the warnings ([data-model.md](./data-model.md)). Every read is
already served, so the change is to `apps/scoresheet` only (research R1).

## Technical Context

**Language/Version**: TypeScript 5, Vue 3 single-file components

**Primary Dependencies**: Vue 3, Vite, `@qzr/shared` (`resultKey`, `quizName`, `foldName`, the
published schedule types), `@qzr/ui` (`useHistory`, `ChoiceDialog`, guest sessions)

**Storage**: browser `localStorage`: the quiz auto-save (unchanged) and the meet session
`qzr-meet-session`, which gains the scheduled quiz copy. No database change.

**Testing**: Vitest with `@vue/test-utils`, tests in `__tests__/` beside the code; `pnpm test:unit`,
`pnpm type-check`, `pnpm lint`

**Target Platform**: the scoresheet as a browser PWA and inside Tauri 2 (desktop, Android)

**Project Type**: pnpm workspace; this feature touches one app, `apps/scoresheet`

**Performance Goals**: a link or refresh is at most one schedule fetch, one roster fetch and one
quizzer fetch per picked team; warnings recompute on each edit from the copy held, with no request

**Constraints**: scoring, saving, plain New, Open from file and unlinking work with no network; no
polling; nothing typed or scored changes except through New, Open or a fix the official takes

**Scale/Scope**: three team slots, fifteen seats; a meet's schedule of some hundreds of quizzes and
stored quizzes of the same order, listed in dialogs. One large component (`Scoresheet.vue`), one
composable (`useMeetSession.ts`), `api.ts`, the store, two dialogs reused and two added.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                                                                                                                                                                                  | Pass when                                          | Answer                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Offline, always                 | Can an official still score, auto-save, and save/load a quiz with the API down? Can any load path drop scores silently?                                                                                                               | yes, then no                                       | Yes: no scoring, save or file path gains a request (FR-027), and fetches the sheet makes by itself fail silently onto the copy held (FR-023). No: New and Open are the only paths that replace scores, both ask first when there are unsaved changes, and apply nothing until their fetch has succeeded (research R6). This removes a path that could: today's "Load from schedule" over a scored sheet. |
| II  | Rulebook is the spec            | Does the feature change scoring, scheduling, auth, roles, or the data model? If so, which doc in `docs/` is amended, and does any new rulebook departure arrive as an opt-in setting documented in `docs/scoring-rules-explained.md`? | doc named, or N/A                                  | N/A for scoring, scheduling, auth, roles and the data model: none changes. `docs/meet-link.md` describes linking and warnings and is amended in the same pull request; `docs/architecture.md` is updated where it describes loading from the schedule.                                                                                                                                                   |
| III | One pure scoring implementation | Does anything outside `packages/shared/src/scoring/` compute a score, validation, grey-out, visibility, overtime, or placement?                                                                                                       | no                                                 | No. Schedule warnings compare names, numbers and team ids; moving a team swaps its order and scores are derived as before.                                                                                                                                                                                                                                                                               |
| IV  | Meet data gated per meet        | Does every new or changed API route touching a meet's data check membership, a guest token for that meet, or superuser? Is any new token or session scheme introduced?                                                                | yes, then no                                       | Yes, vacuously: no route is added or changed. The stored quiz list is read through `GET /results`, whose existing check decides who sees what (research R1). No.                                                                                                                                                                                                                                         |
| V   | Contract versions               | Does it touch `packages/shared/src/`? If so, which semver level, is it bumped once in this PR, and does it change `FILE_VERSION`?                                                                                                     | level named, or N/A                                | N/A: `packages/shared` is not touched and `FILE_VERSION` does not change.                                                                                                                                                                                                                                                                                                                                |
| VI  | Validate before merge           | Are scoring and validation changes covered by unit tests in `__tests__/`? Is every D1 schema change shipped as a migration from `db:generate`?                                                                                        | yes, or N/A                                        | N/A for both: no scoring or validation change, no schema change. The link routine, warnings, fixes and the team swap get tests regardless (research R13).                                                                                                                                                                                                                                                |
| VII | Simplest design that works      | Does every decision or write path the feature adds have one owner in Reuse and Ownership? Does the design add a production export, option, or state that only a test reads, duplicate existing code, or restate a framework default?  | post-design: yes, then no (pre-research: deferred) | Yes: see Reuse and Ownership; linking in particular has one routine that New from schedule, both server Opens and the refresh symbol all call. No: `computeSeatChange` and `loadScheduledQuiz`'s per-seat policy are deleted rather than kept beside the new routine, and `dropPicks`, called by hand at three sites, is removed: a file open unlinks.                                                   |
| -   | Technology constraints          | Does it add a package or deployable, a cross-origin production client, or HTML5 drag?                                                                                                                                                 | no, or justified                                   | No. The team move is a button, not a drag (research R8).                                                                                                                                                                                                                                                                                                                                                 |

Post-design re-check: unchanged. No violation to justify.

## Project Structure

### Documentation (this feature)

```text
specs/007-open-new-link/
├── plan.md              # This file
├── research.md          # Findings and decisions R1 to R13
├── data-model.md        # The meet session's scheduled quiz copy; link states
├── quickstart.md        # Automated and by-hand checks
├── contracts/
│   └── client.md        # Menus, questions, warning lines, portal links, routes read
├── checklists/
│   └── requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/scoresheet/src/
├── api.ts                              # two client calls added: stored quizzes, a quiz's versions
├── composables/
│   ├── useMeetSession.ts               # scheduled quiz copy; fresh fetch; unlink quiz; slot swap
│   └── __tests__/useMeetSession.spec.ts
├── stores/
│   ├── quizStore.ts                    # two teams change places
│   └── __tests__/
├── components/
│   ├── Scoresheet.vue                  # the link routine; New, Open, Link menus; linked display;
│   │                                   # schedule warnings and fixes; portal link handling
│   ├── SchedulePickerDialog.vue        # reused for three actions
│   ├── MeetPickerDialog.vue            # reused for Link a meet
│   ├── (new) stored quiz picker dialog # stored quizzes and their versions
│   ├── (new) warnings dialog           # the warning list with its fixes, replacing the alert
│   └── __tests__/
└── tutorial/                           # unchanged unless a step names a removed menu item

docs/meet-link.md                       # linking rules, schedule warnings, refresh
docs/architecture.md                    # where it describes loading from the schedule
apps/scoresheet/CHANGELOG.md
```

**Structure Decision**: everything lands in `apps/scoresheet`, in the files that own the meet link
today. Two dialogs are new components because `Scoresheet.vue` is already the largest file in the
app and each is a self-contained list; nothing else gets a new module.

## Reuse and Ownership

| Decision or write path                                                            | Owner (existing symbol, or file and responsibility if new)                                                                                                  | Existing code reused                                                                |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| What linking does to each slot, division and number (keep, pick by name, or fill) | `onMeetLoaded` in `Scoresheet.vue`, grown into the one link routine that takes what to link (research R5)                                                   | `findMatchingTeam`, `pickMisspeltTeam`, `pickTeam`, `teamsFreeFor`                  |
| Starting a quiz from the schedule                                                 | the New handler in `Scoresheet.vue`: reset, then the link routine. `loadScheduledQuiz` and `computeSeatChange` are removed                                  | `newQuiz`, `resetStore`, `SchedulePickerDialog`'s `onPick`                          |
| Opening a saved quiz from any source; a file open unlinks                         | `openJsonQuiz` in `Scoresheet.vue`, the one open path; a file open ends the meet session there, and `dropPicks` goes                                        | `openFile`, `openJsonQuiz`, `getRevision`                                           |
| Asking before replacing the sheet, and applying nothing on cancel or failed fetch | the New and Open handlers in `Scoresheet.vue`, in one order: ask, fetch, apply (research R6)                                                                | `confirmAction`, `isDirty`                                                          |
| Waiting on the meet, with Cancel as the only action (FR-028)                      | new: one waiting state in `Scoresheet.vue`, entered by every action the official starts that fetches; cancelling restores the sheet and discards the answer | `closeMenus`, the dialog pattern of `ChoiceDialog`                                  |
| Discarding what the reload fetch brings when another quiz was started meanwhile   | `quizEpoch` in `useMeetSession.ts`, extended to the scheduled quiz fetch                                                                                    | the existing guard in `assignTeam` and `refresh`                                    |
| The copy of the linked scheduled quiz, and when it is written or cleared          | `useMeetSession.ts`, beside `quizId` (data-model.md)                                                                                                        | `applyLoadedQuiz`, `startNewQuiz`, `clearSession`, `persist`, `snapshotSession`     |
| Fetching the meet's roster, divisions and schedule afresh                         | `refresh` in `useMeetSession.ts`, extended to the scheduled quiz; the refresh symbol calls it and then the link routine; reload and submit call it alone    | `getMeetTeams`, `getPublishedSchedule`, `getScheduledQuiz`, the existing race guard |
| Which stored quiz a scheduled quiz has                                            | one lookup in `Scoresheet.vue`, where New from schedule and Open from the schedule both need it                                                             | `resultKey` and `scheduleQuizMeta` from `@qzr/shared`                               |
| Who may see stored quizzes                                                        | the server: `GET /results` in `packages/api/src/routes/results.ts`, unchanged. The sheet shows the list or the refusal                                      | `ApiError` status                                                                   |
| The warning list, roster and schedule lines together, each with its fix if any    | `meetWarnings` in `Scoresheet.vue`, now entries rather than strings; the cell flags and the submit question read the same list                              | `teamNameIssue`, `teamNameIssueLine`, `warningList`, `given`, `lacksDivision`       |
| Two teams changing places                                                         | new: one action in `quizStore.ts` swapping `seatOrder`, wrapped with an undo entry in `useScoresheet.ts`; the picks swap in `useMeetSession.ts`             | `moveQuizzer`'s pattern, `history.push`, `reorderSlotQuizzers`'s pattern            |
| Taking a schedule's value (division, number, team)                                | the fix carried by the warning entry, run from the warnings dialog; a team fix is the swap above or `pickTeam` for a team not on the sheet                  | `pickTeam`, `setTeamName`                                                           |
| Showing the warnings with their fixes                                             | new: one dialog component, opened by the warning count; replaces `showMeetWarnings`'s `alert`                                                               | `ChoiceDialog`'s look and dialog pattern                                            |
| Listing stored quizzes and their versions                                         | new: one dialog component, with the two new client calls in `api.ts`                                                                                        | `SchedulePickerDialog`'s pattern, `quizName`                                        |
| The linked display, the Link menu and the refresh symbol                          | the session pill in `Scoresheet.vue`, grown (research R9)                                                                                                   | `meetSession.meetName`, the file-menu dropdown markup                               |
| Reading portal links                                                              | `loadFromUrlParams` in `Scoresheet.vue`, calling New from schedule and Open from the meet                                                                   | the existing parameter parsing and clean-up                                         |
| The scheduled quiz's id for a submission                                          | `quizId` in the meet session, unchanged; the stats work reads it                                                                                            | as is                                                                               |

**Platform already provides**: `GET /results` returns each stored quiz with its newest revision's
file, and the newest revision is the current one, so opening a stored quiz's current version needs
no second request; the same route enforces who sees which quizzes. The published schedule is served
to anyone who may view the meet. `useHistory` gives undo and redo to any pushed entry. The tutorial
snapshots and restores the whole meet session, so new session fields are covered without a change.

**Releases**: scoresheet MINOR. `packages/shared`, `api` and `web` are unchanged; the bundled
contract line in the scoresheet's changelog names the shared version on master when the bump is
written.

## Complexity Tracking

No violations.
