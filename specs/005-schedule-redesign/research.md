# Research: Schedule builder redesign

Decisions taken before design, each with what was weighed. Spec references are to
[spec.md](./spec.md); rule IDs to [schedule-invariants.md](../../docs/schedule-invariants.md).

## R1. Where the builder runs

**Decision**: the builder is a page of the portal (`apps/web`), at a top-level path that needs no
account (beside `/roadmap`), and opens on a meet's linked schedule from the meet's Schedule tab. It
replaces today's editor there. The portal's read-only schedule view stays as it is, reading the
published document.

**Rationale**: the people who build schedules are meet directors and admins, who already manage
meets, teams and rooms in the portal; the scoresheet is for officials on the day. Offline isn't
needed (spec, 2026-11-02): once the page has loaded, all the logic runs in the browser, so editing
and saving don't need the network, and the portal needs no service worker. A top-level path shadows
a meet slug of the same name, as `/roadmap` already does, so the path's name is reserved.

**Alternatives considered**: a second screen of the scoresheet (offline for free, but the wrong
audience, a bigger download for officials, and a jump between apps for linked schedules); a new app
(a new deployable to justify, for no gain); an offline portal page with its own service worker
(build setup for a need nobody has).

## R2. Where the schedule logic lives

**Decision**: every pure decision (frame presets, the prelim draws, prelim placement and Sort, the
elim structure and bracket library, round robins, the draw with late teams, the conflict check,
re-flow around pins, the schedule file codec) lives in a new `packages/shared/src/schedule/` folder,
as functions over plain data with no Vue and no I/O, like `scoring/`.

**Rationale**: three consumers need the same answers: the builder, the API (which validates what it
stores and serves the published version), and the portal and scoresheet readers. One implementation
keeps a conflict, a rank range or a label from being computed two ways (Principles III and VII
applied to scheduling). Pure functions also make the invariants testable one by one.

**Alternatives considered**: keep the logic in `apps/web` where today's editor has it
(`prelimDraw.ts`, `scheduleAlloc.ts`, `scheduleArrange.ts`, `scheduleSort.ts`, `brackets.ts`); the
API and the scoresheet couldn't use it.

## R3. What carries over from today's code

**Decision**: reuse, moving into `packages/shared/src/schedule/`:

* the rule-book prelim tables in `apps/web/src/prelimDraw.ts` (data, checked against `docs/rules.md`
  by its tests);
* the stats-break and grid-row helpers in `packages/ui/src/scheduleGrid.ts`, where they still apply;
* `foldName` and `quizName` in `packages/shared/src/results.ts`, to match a schedule's quizzes to
  submitted results (H-20, FR-035b).

Replace, not port: `scheduleAlloc.ts`, `scheduleArrange.ts`, `scheduleSort.ts`, `scheduleBuild.ts`
and the four editor sections. They implement the tab workflow and the single greedy pass the spec
retires (Context, points 1 and 4). Their test scenarios are mined for cases.

From the mockup ([mockup.html](./mockup.html)), port the approaches, not the code: slot-by-slot
placement with a depth-first search for letter-disjoint quizzes; the across-rooms Sort that moves
each block edge at most once; the draw's late-team scoring; round-robin seating.

**Rationale**: Principle VII asks for reuse first; the rule-book tables and name folding are proven
and tested. The allocation code embodies the design being replaced.

**Alternatives considered**: port the old allocation code and adapt it (it assumes one meet-wide
stats break and a single greedy pass, the two problems the redesign exists to fix); copy the
mockup's code (written for speed of iteration, untyped and untested).

## R4. Standalone storage and the schedule file

**Decision**: a standalone schedule is one JSON document, the **schedule file**, with its own
`SCHEDULE_FILE_VERSION` starting at 1. The builder auto-saves every schedule to `localStorage` (one
key per schedule plus an index), and saves and opens files the way the scoresheet does (the browser
path of `apps/scoresheet/src/persistence/fileIO.ts`: the save picker where the browser has one, a
download otherwise, and a file input to open). Loading follows the `QuizFile` rule: an older version
opens with defaults for what it lacked; a newer or invalid file fails with a message (FR-003).

**Rationale**: the same mechanics the scoresheet already proves, with one document as the unit of
save, undo history aside. FR-002 and SC-006.

**Alternatives considered**: IndexedDB (more capacity than needed: a 90-team schedule is well under
1 MB of JSON); one key for all schedules (a write of one would rewrite every other).

## R5. Linked storage on the server

**Decision**: a linked schedule is stored as the same document: the draft in a new `meet_schedules`
table, one row per meet with a revision number, and every published version in a new append-only
`meet_schedule_versions` table (FR-049a), numbered per meet with when and by whom. The newest
version is what the portal viewer and the scoresheet's picker read (FR-050). Saving the draft sends
the revision it was based on; a mismatch is refused with the newer draft, and the builder shows the
conflict in the page. The builder saves the draft shortly after each change and keeps it in the
browser meanwhile, so a lost connection only delays the save (FR-048a).

Existing meets (FR-053) are converted on first open: when a meet has no `meet_schedules` row but has
rows in `meet_slots` and `scheduled_quizzes`, the API builds a document from them, every quiz
pinned, placeholder elim seats as seats with no source, and stores it as the draft and as version 1.
The `/schedule/sync` route goes with the old editor, its only caller. The old tables are then unused
by the builder; dropping them is a later change, once every meet has been converted. The old read
routes stay, answering from the newest published version, because installed scoresheets call them
for their picker.

**Rationale**: the document is already the unit of the standalone builder, so linking adds a place
to keep it, not a second model. A draft plus whole published versions gives FR-049, FR-049a and
FR-052 with no per-row `publishedAt` bookkeeping; versions are append-only like
`quiz_result_revisions`, and small enough (well under 1 MB each) to keep every one. Results already
identify quizzes by result name (`quiz_results` `quizKey`, from `quizName`), not by schedule row, so
nothing needs a row per quiz to keep working.

**Alternatives considered**: keep the relational rows and write them on publish (two owners of the
same schedule, and the rows can't hold pins, settings, single-room events or note rows without
another round of columns); store only the published version (no server-side draft, so an admin's
work lives in one browser).

## R6. Team names, lateness and absence when linked

**Decision**: when linked, the meet's teams (names, counts) are read from the existing `teams` and
`churches` tables (FR-047); the draw (letter per team), late marks and absent marks live in the
schedule document. The existing `teams.lateness` column is read once, when a meet's schedule is
first created or converted, to seed the late marks, and is no longer written.

**Rationale**: one owner for each fact. Lateness and absence are scheduling choices made in the
builder (FR-042a, FR-042b); team identity belongs to registration.

**Alternatives considered**: keep writing `teams.lateness` from the builder (two owners of one
fact); keep the draw in `prelim_assignments` rows (a second model beside the document, written on
every redraw).

## R7. Undo, drag and printing

**Decision**: undo and redo reuse the scoresheet's `useHistory` command stack, moved to
`packages/ui` so both apps use one copy, with whole-document snapshots as commands (FR-006). Drag
uses pointer events, as the portal's `useDragReorder` does, with a select-then-choose path for every
drag (FR-005a). Printing uses print CSS on the read-only grid (`packages/ui/src/ScheduleGrid.vue`),
shared with the portal viewer, and `window.print()` (FR-044).

**Rationale**: reuse (Principle VII); pointer events per the Technology Constraints. A schedule
document is small enough that snapshots are cheaper to get right than inverse operations.

**Alternatives considered**: inverse operations per edit (more code and more ways to drift from the
document); HTML5 drag (crashes Tauri on Linux, and the constitution forbids it); a PDF export
(heavier, and print CSS already gives the printouts the examples show).

## R8. Performance

**Decision**: generation and re-flow run synchronously on the main thread, with no worker.

**Rationale**: the mockup's placement and across-rooms search run in tens of milliseconds for the
reference meets (three divisions, 39 to 64 teams). FR-014 and SC-007 allow two seconds for 60 teams;
the CMQ meet (50 teams, 9 rooms) is the largest case and is part of the test set. A worker is added
only if a test shows the budget missed.

**Alternatives considered**: a web worker from the start (structure with no measured need).

## R9. Bracket library data

**Decision**: the library is data in `packages/shared/src/schedule/`, one entry per bracket, each a
list of quizzes with seat sources in bracket terms and the deciding quiz marked. The entries are
written out in [bracket-library.md](./bracket-library.md), read from the printouts (the 5-team one
completed from the Heritage 2025 photo) and CMQ's C division as run; CMQ's 13 to 20-team brackets
wait for a working copy, since several of their cells are broken.

**Rationale**: FR-029; data with tests (every entry satisfies H-12 to H-16 for its size) rather than
code per bracket.

**Alternatives considered**: generating brackets from a rule (no rule reproduces the org's 7, 8 and
10-team brackets); a bracket editor for directors (the grid already lets them build any bracket by
hand, FR-004a).

## R10. Matching a schedule quiz to its results

**Decision**: a schedule quiz's result name is `quizName` of its division, whether its lane is a
consolation lane, and its number or letter, folded, exactly as the scoresheet saves it. The picker
fills those fields from the schedule quiz, and the API matches the same name to `quiz_results` to
protect quizzes with results (H-20). The conflict check warns when two quizzes share a result name
(W-5).

**Rationale**: no change to the scoresheet's quiz file or to stored results. Only lanes that each
restart their letters at A can clash, and that isn't the default.

**Alternatives considered**: record the lane in the quiz file so names can't clash (a `FILE_VERSION`
bump touching the scoresheet, results and the shared contract; recorded as future work in the spec).
