# Research: Each scoresheet tab keeps its own quiz, and recent quizzes are kept

Findings from the code on master (`0435406`) and the decisions they lead to. Each decision names the
requirement it serves.

## What exists today

* **Auto-save** (`apps/scoresheet/src/persistence/autoSave.ts`) writes one serialized quiz to
  `localStorage` under `qzr-sheet:current`, debounced 300 ms from `useScoresheet`'s watchers. Five
  other paths write it directly: `loadFile`, `resetStore` (clears it), `clearAnswers`, `clearNames`
  and `discardKeptNewerAutoSave`. A newer build's auto-save is set aside under
  `qzr-sheet:newer-autosave:<iso time>`, or kept in place with auto-save paused when that fails.
* **The meet link** (`useMeetSession.ts`) is one module-level session persisted to
  `qzr-meet-session`, read once when the module loads.
* **Undo** is `useHistory` in `packages/ui`: closures, at most 100, with `isDirty` comparing the top
  of the stack with the one marked saved. `useScoresheet` pushes at seven sites (answer, team swap,
  no-jump, three timeout paths, the restored-quiz dummy) and `Scoresheet.vue` at one (`editAsOne`).
  Names, on-time marks, question types, quizzer order and quiz settings are not in history. The web
  app's schedule builder uses `useHistory` too.
* **Unsaved** today is `isDirty || namesChanged`, where `namesChanged` compares names with those
  kept by `keepNames` at the last save, start or open (007).
* **The tutorial** copies the quiz and meet session to `qzr-sheet:tutorial-snapshot` and
  `qzr-sheet:tutorial-meet-snapshot`, pauses auto-save, and restores from them on finish or after a
  crash. The copy is needed only because `loadFile` writes the practice quiz despite the pause.
* **Shared person data**: sign-in cookies, guest sessions (`useGuestSession.ts`), fetched team names
  (`useTeamNames.ts`), the meet last submitted to, and the theme, each in its own `localStorage`
  key.
* **Nothing** in the scoresheet uses `sessionStorage`, IndexedDB, Web Locks or `BroadcastChannel`
  yet. Tests run in jsdom, which has none of the last three.

## R1. Where quizzes are kept: IndexedDB

**Decision**: one IndexedDB database for the scoresheet, holding every quiz record (the tabs' own
and the recent ones alike) and a little bookkeeping (data-model.md). Accessed through the `idb`
package; tests use `fake-indexeddb`.

**Rationale**: up to 120 quizzes, each with up to three states and up to 1000 undo steps, is several
megabytes and can reach the low tens in the worst case. `localStorage` gives about 5 MB per origin,
and writing a large value to it blocks the page on every keystroke's save. IndexedDB is in every
target (Chrome, Firefox, Safari, Edge, the Tauri webviews and Android WebView), is asynchronous, and
lets one transaction read and write several records together. `idb` is a small promise wrapper over
the browser API; writing that wrapper by hand would restate it (principle VII).

**Alternatives considered**: `localStorage` (too small, synchronous); `sessionStorage` for each
tab's own quiz (per tab for free, but gone when a browser doesn't restore its tabs, which the spec
relies on to turn them into recent quizzes); the origin private file system (no gain over IndexedDB
for small records, weaker support in webviews).

**Constitution**: principle I says auto-save goes to `localStorage`. The intent, a copy on the
device on every change with no network, holds. The amendment rewords it to "kept on the device on
every change", a PATCH clarification, in the same pull request (plan, Complexity Tracking).

## R2. Telling tabs apart, and knowing which are open: the tab's quiz id and Web Locks

**Decision**: a tab keeps the id of its quiz record in `sessionStorage`, and holds an exclusive Web
Lock named after that record for as long as it shows it. A record whose lock nobody holds is a
recent quiz. Claiming a record (restoring it, continuing it on Open, or taking it back on reload) is
`navigator.locks.request(name, { ifAvailable: true })`: the browser grants it to one tab only, which
settles two tabs restoring the same quiz (FR-015) without a compare-and-set. Counting the open tabs
is counting the held locks of that name (`navigator.locks.query()`).

* **Reload** (FR-002): `sessionStorage` survives it; the tab asks for its lock again, waiting up to
  a second for the page it replaces to let go of it, and loads its record.
* **Duplicated tab** (FR-004): the browser copies `sessionStorage`, so the copy names a record whose
  lock the original holds. The copy writes a new record from it (same state, link and history, new
  id) and takes that one's lock. A record still held after the reload's wait is a duplicate's: the
  original never lets go.
* **Crash and restored session** (FR-005): restored tabs keep `sessionStorage` and take their locks
  back. A browser that restores nothing leaves the records unlocked: recent quizzes, offered as
  FR-010 says.
* **Race on reload**: between a tab unloading and reloading, its lock is free for a moment, and a
  new tab opening in that moment could restore the quiz. The reloaded tab then cannot take the lock,
  which is the duplicated-tab case: it gets a copy. Nothing is lost; the quiz shows twice.
* **No Web Locks** (WebKit before 15.4): every record but the tab's own is treated as recent, as if
  there were one tab. The desktop and Android apps have one window, so this is exact there.

**Rationale**: locks are released by the browser when a tab closes or crashes, which is the event
the spec turns on, and which a page cannot reliably write anything during. A record never moves
between "a tab's" and "recent": only its lock comes and goes, so there is no write on close to lose.

**Alternatives considered**: heartbeats in storage (a closed tab looks open until it times out, and
every tab writes every few seconds); `BroadcastChannel` roll calls (asynchronous, and a crashed tab
never answers, so still a timeout); a separate tab id beside the quiz id (one more thing to keep in
step, with no question it answers that the quiz id doesn't).

## R3. One writer per tab

**Decision**: the tab's record has one writer, debounced 300 ms from the existing watchers as today,
and paused by `pauseAutoSave` as today. `loadFile`, `resetStore`, `clearAnswers`, `clearNames` and
the newer-quiz paths stop writing storage themselves and go through it. It flushes on `pagehide`,
best effort.

**Rationale**: one owner (principle VII), and a pause that really pauses removes the tutorial's need
for its own copies (R12).

## R4. What a quiz's state is, and when it is saved

**Decision**: a quiz's state is its quiz file in a canonical form: `storeToQuizFile`'s output with
answers, question types and no-jumps sorted, so that the same quiz reached by different edits
compares equal. Saved status is computed, not tracked: the quiz is saved when its canonical state
equals its last saved state, or equals its last submitted state while it is linked to the scheduled
quiz that submission went to (FR-009). The canonical string is computed when the writer runs, which
is cheap for a quiz of this size.

This replaces `history.isDirty`, `namesChanged` and `keepNames` in the scoresheet: none has a caller
left once New and Open stop asking (FR-019) and saved status is a comparison.

**Alternatives considered**: hashing states (the strings are short enough to compare, and a hash
adds a dependency or an async digest for nothing); keeping `isDirty` (it cannot tell a quiz edited
back to its saved state, which the spec counts as saved).

## R5. Undo history that survives a reload: steps as data

**Decision**: the scoresheet's undo steps become data: each records the parts of the quiz state that
changed, before and after, so that undo and redo apply one or the other and a step can be stored.
Each edit site records its step from the state around the edit instead of writing closures. A step
may also carry an in-memory action for what lives outside the quiz (the meet picks a team swap
moves); that part is not stored, so after a reload an undo meets the links as typing the names back
would (spec edge case): seats are relinked by name after every undo and redo, and a team's pick is
flagged when its name no longer names it.

`useHistory` in `packages/ui` stays the history for both apps: it gains a type parameter for its
steps, a way to read its stacks for storage and to set them on load, and the scoresheet passes a
limit of 1000 (FR-020). The schedule builder keeps its closures and its limit.

Every change to what a quiz file holds is a step (FR-020): names, on-time marks, quizzer order,
question types and the quiz's settings join the edits that were steps already, and every input that
wrote the store directly (`v-model` on the quiz's settings, the name inputs) goes through the same
`edit`. Typing amends the step on top while the same field keeps focus and nothing else was edited,
so a visit to a field is one step; leaving the field ends it. Changes the sheet makes by itself (a
link filling names, a roster change) go through one more door: while the quiz is still at its start
(no steps, state equal to `start`) they change the sheet without a step and the start is taken
again, as R8 already does; after the first edit by hand they are steps like any other. Clear answers
and Clear names are one step each instead of emptying the history, so a quiz's history begins only
at New or Open.

**Rationale**: closures cannot be stored. Recording the changed parts of the state, rather than one
record kind per edit, keeps one way to record and apply a step for every edit there is and every one
added later. Every change being a step is what lets a quiz's states join (R7): a change outside the
history would let redo from an earlier state reach a mix that never existed.

**Alternatives considered**: one stored record kind per edit (eight kinds to keep in step with their
closures, and each new edit needs a new kind); full snapshots per step (up to 1000 copies of the
quiz per state); keeping names out of history, as master did (redo from a saved state then lands on
the latest answers with the saved names); grouping typing by a pause instead of by field (slow
typing splits a name, quick separate edits merge).

## R6. A quiz's kept states

**Decision**: a record holds its current state with its undo and redo steps, and, when they differ
from it, its last saved state and last submitted state, each with the undo steps that led to it
(FR-022). A save to a file sets the saved state when the save succeeds (where `markSaved` is called
today); a submission sets the submitted state when the meet stores it, with the meet and scheduled
quiz it went to; opening a file or a submission from the meet sets the one it came from (FR-022).
Rows whose states are equal show once.

## R7. Open finds the quiz it came from

**Decision**: every Open (file, the meet, the schedule, a link) compares what it opens, in canonical
form, with each recent record's current, saved and submitted states, the submitted state also
comparing the scheduled quiz (FR-009, FR-023). The most recently changed match that the tab can
claim (R2), other than the record it is replacing, is continued in the matched state; with none, or
with the only match open in another tab (said so), it starts a new record.

Continuing from a state other than the current one keeps the way forward: when the matched state's
undo steps begin the current state's, the rest become redo steps. A record positioned behind its
current state remembers that state; the first edit there (a Clear is an edit) first writes the
dropped state, with its history, as a recent quiz of its own (FR-023). Restoring a saved or
submitted row (FR-013) positions the record the same way.

**Rationale**: the comparison is a string equality over at most 120 records with three states each,
read once per Open; no index is needed.

## R8. Which quizzes are kept

**Decision**: a record is kept as a recent quiz only while it is worth keeping: it has a saved or
submitted state, any undo or redo step, or its state differs from its starting state. The starting
state is taken when New or Open begins a record, and taken again when the sheet changes a record
still in its starting state by itself (a link filling names), so such changes don't count (FR-008).
The tab still writes a record that isn't kept, so a reload brings back its quiz and link (FR-002);
the list, the offer and Open's matching skip it, and the pass that keeps the limits deletes it once
no tab holds it.

**Rationale**: the same comparison as R4 against one more state; it replaces `keepNames`, whose job
it was.

## R9. A new tab's offer

**Decision**: when a tab starts with no quiz of its own (no id in `sessionStorage`, or a record
gone):

1. With quiz-opening URL parameters, it opens them (FR-011) and says, in a notice with a way to the
   list, whether unsaved quizzes are waiting.
2. Otherwise it gathers the recent records that are unsaved and not yet offered. One, with no other
   tab open, is claimed and shown without a question (FR-010). Several, or one with another tab
   open, are listed in the recent quizzes dialog with the choice of a blank quiz.
3. Every record shown in an offer is marked offered (FR-010). A record a tab replaces (New, Open,
   restore) is marked offered when it is replaced, since it was not left by a closed tab.

## R10. Limits, dropped quizzes, and full storage

**Decision**: after any record leaves a tab and when a tab starts, one pass keeps the 80 most
recently changed unsaved recent quizzes and the 40 saved ones, and deletes the rest. The names of
dropped unsaved quizzes go into a bookkeeping list, shown once the next time the list or an offer is
shown, then cleared (FR-009). A write refused for lack of room first drops saved recent quizzes,
oldest first, never unsaved ones; if there is still no room, the tab says so (contract), which
master never did (#92 found its failures swallowed). Any other failed write is said the same way,
and the writes after it still run.

## R11. Moving from the previous version

**Decision**: the first tab to start after an update, under an exclusive Web Lock so that only one
does it, moves the old keys into records and removes them (FR-017):

* `qzr-sheet:current` with `qzr-meet-session` and `qzr-sheet:opened-from-newer-file` become this
  tab's record, with an empty undo history and no saved state (as today, a restored quiz counts as
  unsaved).
* `qzr-sheet:newer-autosave:*` become recent records holding the raw text, marked as from a newer
  version (FR-016).
* A tutorial snapshot left by a crash during the tutorial becomes this tab's record instead of
  `qzr-sheet:current`, which held the practice quiz; unless the snapshot is a newer version's, which
  the previous version kept in place while scoring went on in `qzr-sheet:current`: then the snapshot
  becomes a newer record and `qzr-sheet:current` the tab's record.

A key is removed only after its record is written, so a failure leaves it for the next start.

## R12. The tutorial

**Decision**: the tutorial pauses the tab's writer (R3) and keeps no copies of its own. On finish
the tab loads its own record again; after a crash, reloading does the same (FR-018). The practice
quiz is never written, so it never becomes a recent quiz. `tutorial-snapshot` and
`tutorial-meet-snapshot` go, apart from their one-time migration (R11).

## R13. The meet link belongs to the quiz

**Decision**: the meet session moves into the tab's record, written by the same writer, instead of
`qzr-meet-session`. Restoring or continuing a record restores its link; a record split off keeps the
link it had. Guest sessions, team names, the meet last submitted to and the theme stay where they
are, shared by every tab (FR-007).

**Rationale**: SC-004 needs the link and the quiz written and read together; two stores would let a
reload pair one tab's quiz with another's link, which is the fault being fixed.

## R14. One dialog for the offer and for Recent quizzes

**Decision**: one recent quizzes dialog serves the new-tab offer (unsaved, not yet offered, with
"Start a blank quiz") and Open ▸ Recent quizzes (every recent quiz, unsaved first, with restore,
discard and "Discard all"). It follows `StoredQuizPickerDialog`'s pattern. contracts/client.md gives
its rows and wording.

## R15. The newer version's quiz

**Decision**: a quiz from a newer version is a recent record holding the raw text, listed and marked
(FR-016). Opening it asks as today (`TRY_NEWER_PROMPT`) and opens it best effort; the raw record
stays until discarded, as today. The header notice and the paused auto-save go: a record that can't
be written blocks nothing else, so nothing needs pausing. The tutorial no longer needs blocking for
it either.

## R16. Tests

**Decision**: unit tests in `__tests__/` for the canonical state and saved status, undo steps as
data (record, apply, store and load, the 1000 limit), claiming and duplicate detection, Open
matching and splitting, keeping and dropping, the offer, and migration. They run against
`fake-indexeddb` and a small Web Locks stand-in shared by those tests. Several tabs, reload, crash
and duplicate are checked by hand in the browser (quickstart.md), since jsdom has one page.
