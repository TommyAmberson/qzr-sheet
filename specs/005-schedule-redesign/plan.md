# Implementation Plan: Schedule builder redesign

**Branch**: `feat/schedule-redesign` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-schedule-redesign/spec.md`

## Summary

Replace the portal's four-tab schedule editor with a builder that generates a complete meet schedule
from team counts and is then tweaked by hand, with pins keeping hand edits through later settings
changes. The builder is a page of the portal that needs no account and no meet (research R1); once
open it edits without the network, keeps schedules in the browser and in versioned files, and links
to a meet as an optional layer. Every scheduling decision (frame, prelim draws and placement, Sort,
elim lanes, intermediates, brackets and round robins, the draw, the conflict check, re-flow) is a
pure function in `packages/shared/src/schedule/` (R2), used by the builder, the API and the readers.
A linked schedule is stored as the same document: a draft that saves itself, and every published
version kept (R5); the portal viewer and the scoresheet's picker read the newest version.

## Technical Context

**Language/Version**: TypeScript 5, Node `>=22.12.0`

**Primary Dependencies**: Vue 3 + Vite and Vue Router (portal), Hono + Drizzle on Cloudflare Workers
with D1 (API). No new dependencies.

**Storage**: standalone, `localStorage` plus files (`.qzrschedule.json`); linked, a new D1 table
`meet_schedules` holding the draft, and an append-only `meet_schedule_versions` holding every
published version (FR-049a).

**Testing**: Vitest (`pnpm test:unit`), with `@vue/test-utils` for components, as today.

**Target Platform**: the portal in a browser, laptop or larger for building, phones for on-the-day
fixes; the scoresheet only for its quiz picker.

**Project Type**: pnpm monorepo, web apps plus a Workers API.

**Performance Goals**: generate or re-flow a 60-team, three-division schedule in under 2 seconds on
a laptop (FR-014, SC-007), on the main thread (R8).

**Constraints**: accountless for standalone, and editing without the network once open (FR-001); no
browser dialogs (FR-007); pointer events for drag (Technology Constraints); phone-usable for
on-the-day fixes (FR-005b).

**Scale/Scope**: up to about 90 teams per division and 9 rooms (CMQ: 36 and 14 teams in 9 rooms);
schedule documents well under 1 MB.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                                                                                                                                                                                  | Pass when                                          | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Offline, always                 | Can an official still score, auto-save, and save/load a quiz with the API down? Can any load path drop scores silently?                                                                                                               | yes, then no                                       | Yes: the builder is a portal page and never touches the scoresheet's quiz store or auto-save; the scoresheet changes only its picker, which reads the published document and degrades as today with the API down. No: no scoresheet load path changes.                                                                                                                                                                                                                                                                                       |
| II  | Rulebook is the spec            | Does the feature change scoring, scheduling, auth, roles, or the data model? If so, which doc in `docs/` is amended, and does any new rulebook departure arrive as an opt-in setting documented in `docs/scoring-rules-explained.md`? | doc named, or N/A                                  | Scheduling and the data model change. Amended in this branch: `docs/scheduling.md` (builder, generation with pins, per-division stats breaks, lanes and intermediates, document storage), `docs/data-model.md` (`meet_schedules`, `meet_schedule_versions`), `docs/architecture.md` (the builder and `schedule/`), `docs/example-winkler-2026.md` §4 (the 4 to 90-team tables), and the new `docs/schedule-invariants.md`. No scoring change; the rule book's elim structure is not the default but stays selectable (XYZ, Brackets A to C). |
| III | One pure scoring implementation | Does anything outside `packages/shared/src/scoring/` compute a score, validation, grey-out, visibility, overtime, or placement?                                                                                                       | no                                                 | No. Scheduling ranks ("2 of A", "1st in pts") are sources, not computed placements; resolving them from results is #16, out of scope.                                                                                                                                                                                                                                                                                                                                                                                                        |
| IV  | Meet data gated per meet        | Does every new or changed API route touching a meet's data check membership, a guest token for that meet, or superuser? Is any new token or session scheme introduced?                                                                | yes, then no                                       | Yes: the schedule routes check admin or superuser, the published read checks any access to the meet ([contracts/api.md](./contracts/api.md)). No new token or session.                                                                                                                                                                                                                                                                                                                                                                       |
| V   | Contract versions               | Does it touch `packages/shared/src/`? If so, which semver level, is it bumped once in this PR, and does it change `FILE_VERSION`?                                                                                                     | level named, or N/A                                | Yes: new `schedule/` exports and the schedule file, additive, so MINOR, bumped once. `FILE_VERSION` unchanged; the schedule file has its own `SCHEDULE_FILE_VERSION`.                                                                                                                                                                                                                                                                                                                                                                        |
| VI  | Validate before merge           | Are scoring and validation changes covered by unit tests in `__tests__/`? Is every D1 schema change shipped as a migration from `db:generate`?                                                                                        | yes, or N/A                                        | Yes: the schedule logic, the file codec and validation, and the routes have unit tests, with the reference meets as fixtures. Both new tables ship as a `db:generate` migration.                                                                                                                                                                                                                                                                                                                                                             |
| VII | Simplest design that works      | Does every decision or write path the feature adds have one owner in Reuse and Ownership? Does the design add a production export, option, or state that only a test reads, duplicate existing code, or restate a framework default?  | post-design: yes, then no (pre-research: deferred) | Yes, see Reuse and Ownership. No: every setting has the generator as its reader; the old editor's allocation code is removed, not kept beside the new; the old tables stop being written (removing them is a later change, see Complexity Tracking).                                                                                                                                                                                                                                                                                         |
| -   | Technology constraints          | Does it add a package or deployable, a cross-origin production client, or HTML5 drag?                                                                                                                                                 | no, or justified                                   | No: a folder in `packages/shared` and a page in the existing portal; same origin; pointer events.                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Project Structure

### Documentation (this feature)

```text
specs/005-schedule-redesign/
├── spec.md
├── mockup.html          # the agreed layout and behaviour
├── bracket-library.md   # the brackets the library holds (FR-029)
├── plan.md              # this file
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.md
│   └── schedule-file.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/schedule/        # new: all scheduling decisions, pure (R2)
packages/shared/src/schedule/__tests__/
packages/api/src/db/schema.ts        # + meet_schedules, meet_schedule_versions
packages/api/src/routes/schedule.ts  # new routes; old ones retired (contracts/api.md)
packages/api/migrations/             # generated
packages/ui/src/ScheduleGrid.vue     # the grid on the document, for builder, portal and print
packages/ui/src/                     # + useHistory, moved from apps/scoresheet for both apps
apps/web/src/                        # the builder page, its components and browser persistence;
                                     # router: a top-level builder path, and schedule/edit on a meet
apps/web/src/views/ScheduleView.vue  # reads the published document
apps/scoresheet/src/                 # the quiz picker reads the published document
apps/web/src/                        # old editor removed: ScheduleEditView, components/schedule/,
                                     # useScheduleData, scheduleAlloc/Arrange/Build/Grid/Sort, brackets, prelimDraw
docs/                                # amendments listed under Principle II
```

**Structure Decision**: logic in `packages/shared`, the builder in the portal (`apps/web`), the
shared read-only grid in `packages/ui`, storage and access in `packages/api`. The scoresheet only
reads the published schedule.

## Reuse and Ownership

| Decision or write path                                             | Owner (existing symbol, or file and responsibility if new)                                                                                                                | Existing code reused                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Prelim letter tables (rule book, 4 to 21) and the rotating draw    | `schedule/`: the prelim draw                                                                                                                                              | tables from `apps/web/src/prelimDraw.ts`, moved                        |
| Frame presets and default rooms                                    | `schedule/`: the frame                                                                                                                                                    | none                                                                   |
| Events in rows, over any rooms (FR-017)                            | `schedule/`: the document and the frame; the builder's edits and grid menus in `apps/web`                                                                                 | the quiz menu's popover, the grid's drag                               |
| Where prelims go (placement, borrowing, packing)                   | `schedule/`: prelim placement                                                                                                                                             | approach from the mockup                                               |
| Sort and Sort across rooms                                         | `schedule/`: prelim placement (same owner: Sort is placement with lateness)                                                                                               | approach from the mockup                                               |
| Elim structure: lanes, intermediates, defaults by size             | `schedule/`: elim structure                                                                                                                                               | none                                                                   |
| Bracket library and round robins                                   | `schedule/`: the library (data) and the elim structure (round-robin seating)                                                                                              | none; entries from the printouts and CMQ (R9)                          |
| Re-flow around pins, Auto-apply's unapplied list                   | `schedule/`: re-flow                                                                                                                                                      | none                                                                   |
| Hard rules, warnings and their messages                            | `schedule/`: the conflict check, keyed by invariant ID                                                                                                                    | none                                                                   |
| The draw (letters, late teams, absent marks)                       | `schedule/`: the draw                                                                                                                                                     | none                                                                   |
| Schedule document shape, version, validation, upgrade              | `schedule/`: the schedule file codec                                                                                                                                      | pattern of `packages/shared/src/quizFileCodec.ts`                      |
| Matching quizzes to submitted results, and W-5 (R10)               | `quizName` and `foldName` in `packages/shared/src/results.ts`; the conflict check owns W-5                                                                                | as is                                                                  |
| Saving: browser, files, and sending a linked draft (FR-048a)       | the builder's persistence in `apps/web`: one owner for every save; a linked draft is kept in the browser and sent after each change, retried when the server is reachable | browser path of the scoresheet's `fileIO.ts`, `autoSave.ts` pattern    |
| Undo and redo                                                      | `useHistory`, moved to `packages/ui` from `apps/scoresheet`                                                                                                               | as is, with document snapshots                                         |
| Drag and select-then-choose                                        | the builder grid in `apps/web`                                                                                                                                            | pointer-event approach of the portal's `useDragReorder.ts`             |
| The schedule grid (builder, portal, print)                         | `ScheduleGrid.vue` in `packages/ui`; the builder adds its editing on top                                                                                                  | the existing grid and `scheduleGrid.ts` helpers, moved to the document |
| Draft save, publish, versions and restore, conversion of old meets | `packages/api/src/routes/schedule.ts`                                                                                                                                     | `requireAdmin`, `requireViewer` in the same file                       |
| What a reader sees by phase                                        | the published read route                                                                                                                                                  | `packages/shared/src/phases.ts`                                        |
| Opening the builder on a meet                                      | the portal router's `schedule/edit` route                                                                                                                                 | existing route, now to the builder                                     |

**Platform already provides**: once loaded, a single-page app keeps running without the network;
`localStorage` and file pickers as the scoresheet uses them; `window.print()` with print CSS; Better
Auth cookies on the shared origin; Vue Router ranks a static path above `/:slug`.

**Releases**: shared MINOR; then api MINOR (new routes and table), web MINOR (the builder replaces
the editor, the viewer reads the published document, and the ui grid and `useHistory` it bundles),
scoresheet PATCH (the picker reads the published document). `@qzr/ui` is private and bundled into
web and the scoresheet, so it isn't released on its own: its changes ship, and are recorded, with
those apps. Each consumer names the bundled shared version.

## Complexity Tracking

| Violation                                                                                                                    | Why Needed                                                                                                                             | Simpler Alternative Rejected Because                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old schedule tables kept, unwritten, after ship                                                                              | Meets built with the old editor are converted on first open (FR-053), which reads those tables                                         | Converting every meet in a migration needs the shared conversion logic inside SQL, and drops data if it fails; removal follows once every meet has a `meet_schedules` row |
| Old read routes (`/rooms`, `/slots`, `/quizzes`, `/quizzes/:quizId/teams`) kept, answering from the newest published version | Installed scoresheets (Tauri, cached PWAs) call them for their picker; without them those releases would show stale or empty schedules | Breaking installed releases at a meet; the routes go when no supported scoresheet release calls them                                                                      |
