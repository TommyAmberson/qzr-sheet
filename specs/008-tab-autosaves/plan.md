# Implementation Plan: Each scoresheet tab keeps its own quiz, and recent quizzes are kept

**Branch**: `feat/tab-autosaves` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-tab-autosaves/spec.md`

## Summary

Every tab gets its own quiz, link and undo history, and every quiz a tab stops showing is kept as a
recent quiz: offered back when it was left unsaved by a closed tab, and listed under Open ▸ Recent
quizzes. New and Open stop asking about unsaved changes, because nothing they replace is lost. A
quiz is one undo history; Open continues the recent quiz it came from, and a quiz is saved when its
state matches its last save or submission.

Technically, the one `localStorage` auto-save becomes a set of quiz records in IndexedDB, shared by
every tab ([research R1](./research.md)). A tab knows its record by an id in `sessionStorage` and
holds a Web Lock on it while it shows it; a record no tab holds is a recent quiz, so closing a tab
writes nothing (R2). The meet link moves into the record (R13), undo steps become data that can be
stored (R5), and saved status becomes a comparison of canonical quiz files (R4). Everything lands in
`apps/scoresheet`, plus a typed, readable history in `packages/ui`.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3 single-file components

**Primary Dependencies**: Vue 3, Vite, `@qzr/shared` (`serialize`, `parseQuizFile`, `quizName`),
`@qzr/ui` (`useHistory`), and new: `idb` (IndexedDB promise wrapper); `fake-indexeddb` for tests
only

**Storage**: IndexedDB database `qzr-sheet` (quiz records, bookkeeping), `sessionStorage` (the tab's
record id), Web Locks (which records tabs hold). Existing `localStorage` keys for person data stay;
the quiz, meet session, newer-file and tutorial keys are moved into records once and removed
([data-model.md](./data-model.md)). No server or database change.

**Testing**: Vitest with jsdom and `@vue/test-utils`, tests in `__tests__/` beside the code;
`fake-indexeddb` and a shared Web Locks stand-in for the storage tests; several tabs checked by hand
([quickstart.md](./quickstart.md)). `pnpm test:unit`, `pnpm type-check`, `pnpm lint`.

**Target Platform**: the scoresheet as a browser PWA (current Chrome, Firefox, Safari, Edge) and in
Tauri 2 (desktop, Android), one window there

**Project Type**: pnpm workspace; this feature touches `apps/scoresheet` and `packages/ui`

**Performance Goals**: an edit's write stays debounced at 300 ms as today; a state comparison is one
string equality; Open compares against at most 120 records with three states each, read once

**Constraints**: works with no network; nothing written on tab close (it can't be relied on); no
polling; storage up to the low tens of megabytes in the worst case (R1)

**Scale/Scope**: up to 120 recent quizzes plus one per open tab; up to 1000 undo steps per state;
one new storage module, one new dialog, and changes to `useScoresheet.ts`, `useMeetSession.ts`,
`useTutorial.ts`, `Scoresheet.vue`, `main.ts` and `packages/ui/src/useHistory.ts`

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                                                                                                                                                                                  | Pass when                                          | Answer                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Offline, always                 | Can an official still score, auto-save, and save/load a quiz with the API down? Can any load path drop scores silently?                                                                                                               | yes, then no                                       | Yes: storage is on the device and no path gains a request. No: New and Open no longer ask, but what they replace is written as a recent quiz first (FR-019); a quiz dropped by the limits is announced (FR-009), and unsaved ones are never dropped for lack of room (R10). Principle I names `localStorage` for auto-save; it moves to IndexedDB, so the principle is reworded in this pull request (Complexity Tracking). |
| II  | Rulebook is the spec            | Does the feature change scoring, scheduling, auth, roles, or the data model? If so, which doc in `docs/` is amended, and does any new rulebook departure arrive as an opt-in setting documented in `docs/scoring-rules-explained.md`? | doc named, or N/A                                  | N/A: none changes. `docs/architecture.md`, which describes auto-save, the meet session's storage and the tutorial's snapshot, is updated in the same pull request.                                                                                                                                                                                                                                                          |
| III | One pure scoring implementation | Does anything outside `packages/shared/src/scoring/` compute a score, validation, grey-out, visibility, overtime, or placement?                                                                                                       | no                                                 | No. The recent quizzes list counts answers; it scores nothing.                                                                                                                                                                                                                                                                                                                                                              |
| IV  | Meet data gated per meet        | Does every new or changed API route touching a meet's data check membership, a guest token for that meet, or superuser? Is any new token or session scheme introduced?                                                                | yes, then no                                       | Yes, vacuously: no route is added or changed. No. Quizzes from a meet stay on the device after sign-out, like saved files; the spec decided this (its 2026-11-17 clarification) and "Discard all" clears them.                                                                                                                                                                                                              |
| V   | Contract versions               | Does it touch `packages/shared/src/`? If so, which semver level, is it bumped once in this PR, and does it change `FILE_VERSION`?                                                                                                     | level named, or N/A                                | N/A: `packages/shared` is not touched, and `FILE_VERSION` does not change: undo history is never in a file (FR-021).                                                                                                                                                                                                                                                                                                        |
| VI  | Validate before merge           | Are scoring and validation changes covered by unit tests in `__tests__/`? Is every D1 schema change shipped as a migration from `db:generate`?                                                                                        | yes, or N/A                                        | N/A for both: no scoring, validation or schema change. Storage, matching, undo as data and migration get unit tests regardless (R16).                                                                                                                                                                                                                                                                                       |
| VII | Simplest design that works      | Does every decision or write path the feature adds have one owner in Reuse and Ownership? Does the design add a production export, option, or state that only a test reads, duplicate existing code, or restate a framework default?  | post-design: yes, then no (pre-research: deferred) | Yes: see Reuse and Ownership; the record has one writer per tab, and five direct auto-save writes fold into it (R3). No: `isDirty`, `namesChanged`, `keepNames`, the tutorial's snapshots, `keptInPlace` and the newer-quiz notice go rather than living beside their replacements; liveness is the browser's locks, not a heartbeat (R2); `idb` is used rather than a hand-written wrapper.                                |
| -   | Technology constraints          | Does it add a package or deployable, a cross-origin production client, or HTML5 drag?                                                                                                                                                 | no, or justified                                   | No workspace package or deployable; two npm dependencies, `idb` and (dev only) `fake-indexeddb`, named in the pull request body. No cross-origin client, no drag.                                                                                                                                                                                                                                                           |

Post-design re-check: unchanged. One justified item, the wording of principle I (Complexity
Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/008-tab-autosaves/
├── plan.md              # This file
├── research.md          # Findings and decisions R1 to R16
├── data-model.md        # Storage layout, quiz records, states and rules
├── quickstart.md        # Automated and by-hand checks
├── contracts/
│   └── client.md        # Recent quizzes dialog, rows, notices, menu item
├── checklists/
│   └── requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/scoresheet/
├── package.json                        # idb; fake-indexeddb (dev)
└── src/
    ├── main.ts                         # the tab's start: migrate, claim or offer, then mount
    ├── persistence/
    │   ├── autoSave.ts                 # becomes the quiz records store (R1, R2, R7, R10, R11)
    │   ├── openedFromNewerFile.ts      # removed: a record field
    │   ├── quizFile.ts                 # canonical quiz file (R4)
    │   └── __tests__/
    ├── composables/
    │   ├── useScoresheet.ts            # undo steps as data, the writer, saved status, kept states
    │   ├── useMeetSession.ts           # the link read from and written to the tab's record
    │   ├── useTutorial.ts              # snapshots removed (R12)
    │   └── __tests__/
    ├── components/
    │   ├── Scoresheet.vue              # no unsaved-changes questions; Open matching; saved and
    │   │                               # submitted marks; Open ▸ Recent quizzes; notices
    │   ├── (new) recent quizzes dialog # offer and list forms (R14)
    │   └── __tests__/
    └── tutorial/                       # unchanged unless a step names a removed notice
packages/ui/src/useHistory.ts           # typed steps, readable and settable stacks
.specify/memory/constitution.md         # principle I reworded (PATCH)
docs/architecture.md                    # auto-save, meet session storage, tutorial
apps/scoresheet/CHANGELOG.md
```

**Structure Decision**: `autoSave.ts` already owns the quiz's storage and the newer-quiz keys, so it
becomes the records store rather than a new module growing beside it. The dialog is a new component
because `Scoresheet.vue` is the largest file in the app and the list is self-contained, as 007's
pickers were.

## Reuse and Ownership

| Decision or write path                                                     | Owner (existing symbol, or file and responsibility if new)                                                                                                                                                                                                                          | Existing code reused                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Reading and writing quiz records, and the bookkeeping                      | `persistence/autoSave.ts`, rewritten as the records store over IndexedDB                                                                                                                                                                                                            | `idb`; the existing newer-file handling's shape                                      |
| Which record a tab shows; claiming one; telling a duplicated tab           | the records store, with the id in `sessionStorage` and a Web Lock per record (R2)                                                                                                                                                                                                   | `navigator.locks`                                                                    |
| A tab's start: migrate, then take its own record, open URL links, or offer | `main.ts`, before mounting, so `useScoresheet` starts with its record in hand as it does today with `loadFromStorage`                                                                                                                                                               | `loadFromUrlParams` in `Scoresheet.vue` for links                                    |
| Writing the tab's quiz, link and history                                   | `schedulePersist` in `useScoresheet.ts`, the one writer, still paused by `pauseAutoSave`; `loadFile` and `resetStore` go through it                                                                                                                                                 | the existing watchers and 300 ms debounce                                            |
| Canonical quiz file and saved status                                       | `persistence/quizFile.ts` beside `storeToQuizFile`; saved status in `useScoresheet.ts`, replacing `isDirty`, `namesChanged` and `keepNames`                                                                                                                                         | `storeToQuizFile`, `serialize`                                                       |
| Undo steps as data, their limit, storing and loading them                  | `useScoresheet.ts` records every change to the quiz as a step through `edit` (a visit to a typed field amends one step; the sheet's own changes take no step only at the quiz's start; Clear is a step); `useHistory` holds them typed, readable and settable, limit 1000 passed in | `useHistory`, `swapTeams`'s `alongside`, `editAsOne`                                 |
| Setting the saved and submitted states                                     | `saveFile` (where `markSaved` is called) and `doSubmitToMeet` (when the meet stores it) in `Scoresheet.vue`, and the open path below                                                                                                                                                | `markSaved`'s call site, the submit outcome                                          |
| Open continuing a recent quiz, or starting one; positioning and splitting  | the one open path in `Scoresheet.vue` (`openJsonQuiz`, `openStored`, and the ODS branch of `openFile`) asks the records store for a match (R7)                                                                                                                                      | `parseForOpen`, `loadFile`                                                           |
| Replacing without asking; the replaced quiz going to the recent quizzes    | the New, Open and restore handlers in `Scoresheet.vue`; `confirmDiscard` is removed                                                                                                                                                                                                 | `newQuiz`, `newFromSchedule`, `openFromSchedule`, `openStoredVersion`, `openFile`    |
| Which quizzes are kept, and the starting state a link may still move       | the writer (R8); the link routine re-takes the start where `keepNames` is called today                                                                                                                                                                                              | `applyLink`'s call sites                                                             |
| The meet link of a quiz                                                    | `useMeetSession.ts`'s `persist` and load, now through the tab's record instead of `qzr-meet-session` (R13)                                                                                                                                                                          | `MeetSessionData`, `snapshotSession`, `restoreSession`, the field migrations in load |
| The limits, dropping, and announcing dropped quizzes                       | the records store, after a record leaves a tab and at start (R10)                                                                                                                                                                                                                   | none                                                                                 |
| Offering, listing, restoring and discarding recent quizzes                 | new: one dialog component with two forms (contracts/client.md); opened from `main.ts`'s start and Open ▸ Recent quizzes                                                                                                                                                             | `StoredQuizPickerDialog`'s pattern, `quizName`, `confirmAction`                      |
| Notices about recent quizzes                                               | the notice row in `Scoresheet.vue`                                                                                                                                                                                                                                                  | the existing notice row                                                              |
| A newer version's quiz                                                     | a record holding its raw text (R15); opened through `parseForOpen`'s prompt                                                                                                                                                                                                         | `TRY_NEWER_PROMPT`, `parseQuizFileAttempt`                                           |
| Moving the previous version's keys                                         | the records store, once, under a Web Lock (R11)                                                                                                                                                                                                                                     | `loadFromStorage`'s parsing, `useMeetSession`'s field migrations                     |
| The tutorial's safekeeping                                                 | `useTutorial.ts`: pause the writer, and reload the tab's record on finish (R12)                                                                                                                                                                                                     | `pauseAutoSave`                                                                      |

**Platform already provides**: Web Locks are released when a tab closes or crashes, so a closed tab
needs no write and no timeout; `navigator.locks.request` with `ifAvailable` grants a lock to one tab
only, which settles two tabs claiming the same quiz. Browsers copy `sessionStorage` into a
duplicated tab and keep it across a reload and a restored session. IndexedDB commits a transaction's
writes together. `parseQuizFile` already migrates older files and refuses newer ones.

**Releases**: scoresheet MINOR. `packages/ui` changes but carries no release. `packages/shared`,
`api` and `web` are unchanged; the bundled contract line in the scoresheet's changelog names the
shared version on master when the bump is written. The stats work (`feat/stats-stages`) edits
`useMeetSession.ts`, `useSubmitToMeet.ts` and `Scoresheet.vue`; whichever lands second rebases.

## Complexity Tracking

| Violation                                                             | Why Needed                                                                                                                    | Simpler Alternative Rejected Because                                                                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principle I names `localStorage` for auto-save; it moves to IndexedDB | up to 120 quizzes with three states and 1000 undo steps each exceed `localStorage`'s room, and large synchronous writes block | keeping the tab's quiz in `localStorage` and recent ones in IndexedDB splits one record across two stores with a move on close, which cannot be relied on (R2) |

The amendment rewords principle I's auto-save line to "kept on the device on every change" (PATCH,
1.4.2), with no change to its gate, in the same pull request.
