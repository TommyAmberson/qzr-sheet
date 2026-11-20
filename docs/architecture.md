# Architecture Reference

This document covers the scoresheet app (`apps/scoresheet/`) and the overall monorepo structure. For
auth implementation see [auth.md](./auth.md). For roles and codes see
[roles-and-access.md](./roles-and-access.md). For the database schema see
[data-model.md](./data-model.md).

## Terms

* **Bench**: where a team sits in a quiz. A quiz has three, red, white and blue, one team each.
* **Seat**: where a quizzer sits. A bench has four seats, and a fifth "seat" is off the bench, with
  the coaches. The scoresheet gives each team a row per seat, five in all.
* The schedule calls a quiz's benches its `seats` (`Seat`, `ScheduleQuiz.seats`, `ScheduleSeat`),
  from before these terms were settled; prose says bench, and new code names them benches.

## Monorepo Structure

```
qzr/
├── apps/
│   ├── scoresheet/   # Vue 3 + Tauri 2 — offline-first scoring tool
│   │   └── src-tauri/  # Tauri 2 Rust backend (desktop + Android)
│   └── web/          # Portal — coach roster mgmt, admin dashboard, viewer standings
└── packages/
    ├── shared/       # QuizFile schema, scoring, role enums, API + auth clients
    ├── ui/           # Workspace-internal Vue components
    └── api/          # Hono + D1 + Drizzle (Cloudflare Workers)
```

## Deployable Units

| URL                                 | App            | Infra                            |
| ----------------------------------- | -------------- | -------------------------------- |
| `www.versevault.ca/qzr/scoresheet/` | Scoresheet PWA | `qzr-web` Worker (static assets) |
| `www.versevault.ca/qzr/`            | Portal         | `qzr-web` Worker (static assets) |
| `www.versevault.ca/qzr/api/`        | API            | `qzr-api` Worker                 |

qzr lives under `/qzr/` because the root of www.versevault.ca belongs to verse-vault
(`specs/001-qzr-subpath`). Pages can only bind a whole hostname, so the portal and the bundled
scoresheet are served by `qzr-web`, a Worker with static assets configured in
`apps/web/wrangler.toml`. Its script serves each app's shell on an asset miss, and redirects qzr's
old addresses (`/scoresheet*`, `/roadmap`) into `/qzr/`. `qzr-api` answers under `/qzr/api/`; the
more specific route wins over `/qzr/*`. The root and `/api/*` are verse-vault's.

Everything is served from one origin, so production needs no CORS headers.

## API Stack

| Concern   | Tech               | Rationale                                                          |
| --------- | ------------------ | ------------------------------------------------------------------ |
| Runtime   | Cloudflare Workers | Zero cold start, free tier, CF-native                              |
| Framework | Hono               | Lightweight, TS-native, CF Workers first-class                     |
| Database  | Cloudflare D1      | Managed SQLite at the edge, binding-only access (no public port)   |
| ORM       | Drizzle            | Type-safe, SQLite/D1 support, auto-generated migrations            |
| Auth      | Better Auth        | OAuth + email/password + sessions + account linking out of the box |
| Sessions  | Cookie-based       | Better Auth manages session cookies — no hand-rolled JWTs          |

```
Request
  → Cloudflare Worker (V8 isolate)
    → Hono (routing, CORS, auth middleware)
      → Drizzle (typed query builder)
        → D1 (SQLite, same-network binding)
      ← typed result
    ← c.json(result)
  ← Response
```

## Scoresheet App

The scoresheet is a standalone offline-first tool. No router, no pages — a single-page scoring
interface. Phase 4 adds a thin optional API client (sign-in, load quiz, submit result) but no
portal-style views. When not signed in, the app works exactly as it does today.

Connected-mode additions:

* **Sign-in button** — OAuth popup (web) or system browser flow (Tauri)
* **Load Quiz** — modal to pick a meet and select an assigned quiz; pre-populates teams and quizzers
* **Submit** — POSTs the serialised `QuizFile` to the API
* **Connected status** in the meta bar — signed-in name, current quiz info, sign-out

Scoresheet API surface:

```
GET  /quizzes/{id}         → { teams, quizzers, room }
POST /quizzes/{id}/result  → QuizFile body
```

## Portal App

A separate web app for everything that isn't live scoring: admin dashboard, coach roster management,
official schedule, and viewer standings.

The portal links into the scoresheet with context. An official viewing their schedule clicks a quiz
and is taken to the scoresheet with the meet and quiz in the address. The scoresheet starts that
quiz on a blank sheet, linked to it, as its own "New from schedule" does.

| Path                        | Flow                                                   |
| --------------------------- | ------------------------------------------------------ |
| Portal → click quiz         | Opens the scoresheet on that quiz, session established |
| Scoresheet → New ▸ New from | Pick the quiz from the published schedule in a dialog, |
| schedule                    | same end state                                         |

What New, Open and Link each do to the sheet, and what linking never changes, is in
[meet-link.md](./meet-link.md).

### The meet's page

A meet is one page in tabs (specs/010-meet-day): Schedule at `/:slug`, then `/quizzes`,
`/standings`, `/roster` and `/setup`, the division picked in `?division=`, so a reload or a shared
link opens the same view. `MeetView` is the shell: it loads the meet and who the reader is in it
(`GET /results/sender`) once, keeps the meet day current through `useMeetDay`, and shares both with
its tabs through `meetPage.ts`. The meet day (`GET /api/meets/:id/day`) holds the published
schedule's quizzes with each one's status and result as this reader may see them, the settled
benches, and the stored quizzes the schedule lacks. `useMeetDay` reads it on opening, on a tab
switch, when the browser tab comes back into view, on Refresh, and every 30 seconds while visible,
one read at a time. Its `beat` tells the open tab to re-read its own data: on Refresh, and when a
read finds the meet changed, so no tab keeps a timer. The published schedule is read for each
version and phase a meet day names. `specs/010-meet-day/research.md` (R7) states the rules.

* **Schedule** draws the published schedule with `ScheduleSheet`, given the meet day as `marks`:
  each bench's settled team and result, and each quiz's status. A quiz's title opens its stored quiz
  for those who may, or the scoresheet for a quiz not in yet, as `?meetId=<meet>&quiz=<quiz id>`,
  the quiz's id in the published schedule document.
* **Quizzes** lists each stage's scheduled quizzes, in or not, and the stored quizzes the schedule
  lacks, from the meet day; admins and officials also read the stored quizzes (`GET /results`) for
  their actions, and admins what needs attention.
* **Standings** shows one division's stats, with its steps for admins (`DivisionSteps`, which Setup
  mounts for every division).
* **Roster** and **Setup** hold the meet page's former sections; Setup includes the stats settings.

The old addresses (`/schedule`, `/results`, `/stats`, `/stats/:division`, `/stats/settings`)
redirect to their tabs.

### Uploads and downloads

Quiz files and LibreOffice sheets go to a meet through the upload in its page's header, on every
tab, and come from it through the Quizzes tab, so a meet can switch format partway through. An
upload (`packages/ui/src/sendQuizzes.ts`) reads each file in the browser, a sheet with the shared
ODS reader, matches it to the published schedule by name for the user to review, then sends each
quiz through the same `POST /api/meets/:id/results` the scoresheet uses, one request per quiz, with
its scheduled quiz and, for an admin, that quiz's room. A file identical to the quiz's current
revision is answered unchanged. The review shows what each file reads as and how it matched, and
suggests the scheduled quiz with the consolation flag the other way for a file that matches none.
Each sent file gets an outcome; the header sums up the last batch in one line, which opens its
report, and a file not sent, on a server error, a timeout or with the meet out of reach, stays in a
Not sent list for another try while the page is open. Downloads are built in the browser too
(`apps/web/src/downloads.ts`), from the quiz files the results list already carries, filling the
meet's template for `.ods` and zipping with `fflate`, so the Worker does no extra work for them.

### Schedule builder

The schedule builder is a portal page (`apps/web/src/views/BuilderView.vue`), at `/builder` for
schedules kept in the browser with no account, and on a meet's schedule edit page
(`LinkedBuilderView.vue`) for its linked schedule. It edits one schedule document through
`useScheduleBuilder`, whose every change is a whole-document snapshot for undo and redo; the
document is kept in `localStorage` on each change, saved to and opened from `.qzrschedule.json`
files, and, when linked, sent to the API as the meet's draft and published as numbered versions. The
logic it runs is pure and lives in `packages/shared/src/schedule/`; the grid it draws is
`ScheduleSheet` in `packages/ui`, which the meet's Schedule tab and the scoresheet's picker draw
too.

## Shared Package (`packages/shared`)

Contract package consumed by both frontend apps and the API (see "Contract package versioning" in
`CONTRIBUTING.md`):

* `QuizFile` TypeBox schema, `FILE_VERSION`, and its enums (`PlacementFormula`, `BonusRule`,
  `QuizFormat`, `CellValue`, `QuestionCategory`)
* Role enums (`AccountRole`, `MeetRole`) and meet phase / division state constants
* `createApiClient` + `ApiError`, the fetch wrapper both apps construct with their own base URL
* `createAppAuthClient`, the Better Auth client factory returning `{ authClient, useAuth }`
* `schedule/`: the schedule document and its codec, the conflict check, the prelim draw tables and
  rotating draw, the frame, placement and Sort, elim shapes and the bracket library, re-flow around
  pins, the team draw, and the views the grid and printouts are drawn from

---

## Scoresheet Internals

## Data Flow

```
quizStore  (reactive data, no scoring logic)
    │
    ▼
useScoresheet  (Vue composable — reactivity layer)
    │   ├── cells: CellValue[][][]            from store.cellGrid()
    │   ├── scoring: TeamScoring[]            from scoreTeam()
    │   ├── assessment: grey-out, validation, timeout errors, placements
    │   │                                     from assessQuiz()
    │   ├── visibleColumns: VisibleColumn[]   from computeVisibleColumns()
    │   └── undo/redo                         via useHistory()
    │
    ▼
Scoresheet.vue  (main grid component, delegates to UI composables)
    ├── useCellSelector  (popup state, option list, open/close)
    ├── useKeyboardNav   (arrow keys, letter shortcuts, undo hotkeys)
    └── useDragReorder   (pointer-event drag, drop target, row refs)
```

Persistence is a side-channel — not part of the reactive graph:

```
useScoresheet  ──debounced write──▶  autoSave  ──▶  IndexedDB record (the tab's own)
               ◀── startTab (main.ts, before mounting) ──

useScoresheet  ──serialize()──▶  fileIO  ──▶  .json / .ods file
               ◀──deserialize()─  fileIO  ◀──  .json / .ods file
```

## Core Types (`packages/shared/src/types/scoresheet.ts`)

* **`CellValue`** — enum: `Correct | Error | Foul | Bonus | MissedBonus | Empty`
* **`Column`** — `{ key, label, number, type, isAB, isErrorPoints, isOvertime }`
* **`Quiz`** — metadata: division, quizNumber, overtime toggle, placementFormula, bonusRule, format
  (`QuizFormat`, fixed when the quiz starts), questionTypes
* **`Team`** — name, onTime, seatOrder
* **`Quizzer`** — name, teamId, seatOrder
* **`PlacementFormula`** — enum: `Rules` (official rulebook) | `Legacy` (pre-2023 spreadsheet)
* **`PlaceKey`** — encodes rank + tie-width: `1`, `1.2`, `1.3`, `2`, `2.2`, `3`

`buildColumns(rules, overtimeRounds)` builds the columns for a quiz format. Column keys for a
20-question quiz: `"1"`–`"15"` (normal), `"16"`/`"16A"`/`"16B"` through `"20B"` (A/B), `"21"`+
(overtime). For a 15-question quiz: `"1"`–`"11"`, `"12"`/`"12A"`/`"12B"` through `"15B"`, `"16"`+
(overtime). The same key can mean different things in the two formats.

## Store (`src/stores/quizStore.ts`)

Factory function, **no singleton**. Creates a fresh store per call. Its state (`quiz`, `teams`,
`quizzers`, and the answer map) is wrapped in Vue `reactive()`, so computeds in `useScoresheet`
re-run when store data changes without version counters. The store holds data and mutations only; it
never calls scoring functions.

* Answers stored in a `Map<"quizzerId:columnKey", Answer>` for O(1) lookup.
* `cellGrid(columns)` derives the `CellValue[][][]` grid on demand, through the shared
  `buildCellGrid` that also lays out stored quiz files.
* `moveQuizzer()` does an insert (not a swap) and reassigns `seatOrder`.

## Scoring (`packages/shared/src/scoring/`)

Scoring lives in `packages/shared` so the scoresheet, the portal and the API score a quiz the same
way (constitution principle III). All scoring functions are **pure functions** — they take
`CellValue[][][]` and `Column[]` and return results. No Vue, no store access. Functions that need
the quiz format's numbers (quiz-out threshold, where regulation ends, overtime round size) take a
`QuizRules` as a required parameter, so a missed call site fails type-checking instead of silently
using 20-question rules.

| File                  | Responsibility                                                               |
| --------------------- | ---------------------------------------------------------------------------- |
| `quizRules.ts`        | `QuizRules` per `QuizFormat`: regulation length, A/B and error-points start  |
| `scoreTeam.ts`        | Per-team score, running totals, per-quizzer stats                            |
| `greyedOut.ts`        | Which cells are disabled (answered, toss-up, foul cascade)                   |
| `columnVisibility.ts` | Which columns render; orphaned column detection                              |
| `validation.ts`       | `ValidationCode` enum, `validateCells()` — all rule violations               |
| `overtime.ts`         | OT eligibility, round count, checkpoint scores                               |
| `placement.ts`        | Progressive 1st/2nd/3rd placement derivation                                 |
| `helpers.ts`          | Pure cell-grid queries (`teamHasValue`, `isResolved`, `isBonusSituation`, …) |
| `cellGrid.ts`         | `buildCellGrid()`: a quiz's answers as `cells[team][seat][col]`              |
| `assessQuiz.ts`       | Validation and timeout checks, and placement once the quiz can be placed     |

### Cell grid indexing

```
cells[teamIdx][seatIdx][colIdx]
```

`teamIdx` and `seatIdx` are positional (sorted by `seatOrder`), not IDs. Column index matches
position in the `columns` array from `buildColumns()`.

### Grey-out vs. validation

* **Grey-out** (`computeGreyedOut`) — visual state only. Prevents interaction. Does not flag data as
  wrong.
* **Validation** (`validateCells`) — flags existing data as invalid. Drives the pulsing red outline
  and tooltips.

A cell can be greyed without being invalid (e.g. a question already answered — the empty cells are
just greyed). A cell can be invalid without being greyed (e.g. an answer recorded on a toss-up
column the team shouldn't have jumped on).

## Meet stats (`packages/shared/src/stats/`)

A meet's stats are computed in the API, never in the portal: the API holds every stored quiz, and
only it can send each caller no more than they may see. The functions that compute them are pure and
live in `packages/shared`, like scoring.

* **Scored once.** `scoreStoredQuiz` turns one stored quiz file into a `ScoredQuiz`: what depends on
  the file alone. The API keeps it beside the revision (`quiz_result_scores`) when the revision is
  saved, keyed by the `@qzr/shared` version that made it. It reads the same pass over the quiz that
  `quizOutcome` reads (`assessStoredQuiz`), so nothing is scored a second way.
* **Ranked on each read.** `divisionStats` builds a division's response from its scored quizzes: the
  quizzes by stage, and the prelim standings through `divisionStandings`. Placement points are
  worked out here, from each team's place and its score before overtime, because the meet's settings
  decide them and a kept score must not go stale.
* **Why not score on each read:** the API runs on the Workers free plan, which allows a request 10
  ms of CPU, and scoring a division's quizzes takes longer than that. A division whose scores are
  missing, or were made by another shared version, is scored a few revisions per request, and the
  stats route answers 503 with `Retry-After` until all are kept; the portal asks again.

* **What is wrong with a quiz** is of three kinds, each found by shared code from the quiz and the
  meet's data alone, with no state of the scoresheet (`quizProblems`):
  * scoring errors, from the quiz itself (`assessQuiz`), kept with its score;
  * roster errors, names held against the teams of the quiz's division and their quizzers;
  * schedule errors, the quiz held against the scheduled quiz it is linked to, and against its
    stage, where an elimination or a Finals must have a winner.

  Roster and schedule errors are worked out each time a quiz is read, so a corrected roster or a
  republished schedule clears them with no new revision. The scoresheet shows the last two kinds as
  warnings while it is linked to a meet; in the portal, which always has the meet, any of the three
  keeps a quiz out of every table until it is fixed or an admin accepts it as scored. Team names are
  compared by one function (`teamNamed`), by full name, then short name, then with punctuation set
  aside.

The portal's results page still scores the quizzes it lists, to show each one's teams and places,
but it ranks nothing: standings come from `GET /api/meets/:id/stats/:division`.

## Composables (`src/composables/`)

### `useScoresheet.ts`

The only place scoring state is derived. Wraps the reactive store and the pure scoring functions in
`computed`s; components read these rather than calling scoring functions themselves.

Key reactive dependencies:

* store state: `cells` and `teams` track the store's reactive data directly
* `internalOtRounds` — grows when `visibleOtRounds` needs more; never shrinks within a session

`rules` is derived from `quiz.format`, and `columns` from `rules`, `quiz.overtime`, and
`internalOtRounds`. All scoring/greyout/validation computeds depend on `rules`, `columns`, and
`cells`. Grey-out, validation, timeout errors and placements come from one `assessQuiz` call, the
same function that places stored quizzes, so the sheet and the portal can't disagree about a
placement. `openedFromNewerFile` marks a quiz opened through the try-anyway path.

The sheet is the one writer to its tab's record: every change, the meet link and the undo history go
through one debounced write, queued after the writes before it. A write that fails is said in a
notice and never stops the next, and a record the tab leaves is let go only once its last write has
landed, so another tab never takes it without that write. `unsaved` compares the canonical quiz file
(`canonicalQuizFile`) with the state the quiz was last saved to a file in, or last submitted in
while still linked to that scheduled quiz, so undoing back to a save makes the quiz saved again. A
quiz with nothing done by hand since New or Open (`editBySheet` takes names a link fills in then as
its start) and nothing saved is still written, so a reload brings it and its link back, but is not
kept (`isKept`): it is never listed, offered or matched, and goes once no tab holds it.
`replaceQuiz` hands the quiz to the recent quizzes before New or Open shows another; `restoreQuiz`
shows a recent one in any of its states, positioned behind its latest state when that was an earlier
one: redo leads back to the latest, and the first edit there keeps the latest as a recent quiz of
its own.

Every change to what a quiz file holds is an undo step, made through `edit`: answers, no-jumps,
timeouts, names, on-time marks, quizzer order, question types and the quiz's settings, and Clear
answers and Clear names, one step each. A quiz's history so begins only at New or Open, which is
what lets an earlier state redo to exactly its latest. Typing goes through `editTyped`, which folds
each keystroke into the step on top until the field loses focus or another edit is made, so a visit
to a field is one step. Changes the sheet makes by itself go through `editBySheet`: part of the
quiz's start while nothing has been done by hand, a step after.

### `useMeetSession.ts`

The link to a meet: its roster, which roster team each of the three slots is picked as, and which
roster quizzer each seat stands for. Kept in the tab's record with its quiz, though a pick is a
helper for the name cells and is never saved to a file or submitted. [meet-link.md](./meet-link.md)
describes how names, picks and warnings behave.

### `useHistory.ts`

Generic undo and redo over steps of the caller's own type, in `packages/ui` so the schedule builder
uses it too. Capped at 100 entries by default; the scoresheet keeps 1000. Its stacks can be read and
set, oldest step first, so the scoresheet keeps them with the quiz. The scoresheet's steps are data
(`undoSteps.ts`): for each part of the quiz an edit changed, its value before and after, so a step
survives a reload. What a step does outside the quiz, the meet picks a team swap moves, runs in the
session only.

### `useCellSelector.ts`

Manages the cell selector popup: open/close state, position, option list (normal vs. bonus), and the
`registerCellEl` map used for keyboard-triggered opens.

### `useKeyboardNav.ts`

Global `keydown` listener (mounted/unmounted). Handles arrow navigation, letter shortcuts
(c/e/f/b/m), Enter/Space, Delete/Backspace, Escape, and Ctrl+Z/Ctrl+Shift+Z undo hotkeys. Exposes
`keyboardMode` — only true after a keypress, suppressed on mouse click — which gates all focus CSS
classes so focus rings only appear during keyboard use.

### `useDragReorder.ts`

Pointer-event drag for quizzer row reordering. Registers row element refs, hit-tests against rects
on `pointermove`, calls `moveQuizzer` on `pointerup`. No HTML5 drag API (crashes on Linux/X11).

### `useTheme.ts`

Dark/light theme toggle. Persists preference to `localStorage`.

## Persistence (`src/persistence/`)

### `quizFile.ts`

TypeBox schema for the `.json` save format (`QuizFile`). `serialize()` converts store state to a
`QuizFile`; `deserialize()` validates and returns a `DeserializeResult` (ok or error with details).

A file records the **version needed to read it**, not the newest version the build knows
(`fileVersionFor(format)`): 20-question quizzes are version 2 with no `format`, so installs from
before quiz formats still open them, and 15-question quizzes are version 3 with `quiz.format`, which
those installs refuse rather than misscore. `FILE_VERSION` (3) is the newest version this build
reads. `parseQuizFile` throws `NewerFileVersionError` for anything newer; `parseQuizFileAttempt`
opens such a file on request, dropping fields it doesn't know but still rejecting an unknown format.
See `specs/002-15-question-quiz/contracts/quiz-file.md`.

### `fileIO.ts`

Platform-aware file I/O. Detects Tauri via `__TAURI_INTERNALS__` and uses the native dialog/fs
plugins; falls back to `showSaveFilePicker` (Chrome) then `<a>` download for web.

Exports: `saveQuizToFile`, `openAnyQuizFile` (handles `.json` and `.ods`), `exportOdsFile`,
`openOtsTemplate`, `confirmAction`.

### `autoSave.ts`

The quiz records store: every tab's quiz, and every quiz a tab no longer shows (a recent quiz), is a
record in the IndexedDB database `qzr-sheet`, shared by the tabs, with its current state, the states
it was last saved and submitted in, each with its undo history, and its meet link
([data-model.md](../specs/008-tab-autosaves/data-model.md) has the fields).

A tab knows its record by an id in `sessionStorage` and holds a Web Lock named after it; a record no
tab holds is recent, so a tab that closes or crashes needs no write. `startTab` runs in `main.ts`
before the sheet mounts: a reload takes its record back (waiting a moment for the page it replaces
to let go of the lock), a duplicated tab copies its original's record, and a new tab brings back the
one unsaved quiz a closed tab left, or offers several (`RecentQuizzesDialog`), each once. The first
start of a version moves the previous version's `localStorage` quiz, meet link and set-aside newer
quizzes into records. `findMatch` gives an Open the recent quiz it continues. The 80 most recently
changed unsaved recent quizzes and the 40 saved ones are kept, an unsaved one dropped being named
once; a write the device refuses makes room from saved quizzes only. Without Web Locks a tab acts as
the only one.

The tutorial sets the quiz aside (`setAside`): written, then the writer paused, so the record keeps
the tab's quiz while the practice quiz is on the sheet and a reload mid-tutorial finds it there, and
held in memory too, so the tutorial's end (`bringBack`) shows it again even when the device's
storage failed.

## ODS (`packages/shared/src/ods/`)

The scoresheet and the portal share these, so a sheet reads and fills the same way in both.

### `fillOts.ts`

Opens a user-supplied `.ots`/`.ods` template as a ZIP, patches the `Quiz` sheet at known fixed cell
addresses with the current quiz data, and returns the modified bytes. All other sheets pass through
unchanged so the template's formulas recalculate in LibreOffice.

### `readOds.ts`

Parses a filled `.ods` file and maps the fixed cell addresses back into a quiz file (teams,
quizzers, answers, no-jumps, question types, metadata). The sheet has one column per question from
16 on, so it places each mark on the question or its A or B sub-question by how the quiz went up to
there (see [ods-format.md](./ods-format.md#ab-answer-guessing)).

### `odsXml.ts`

Low-level helpers for reading/writing ODS XML: ZIP entry parsing via `fflate`, cell value
extraction, and XML patching.

## Components (`src/components/`)

`Scoresheet.vue` is the scoring grid. It reads from `useScoresheet()` and delegates interaction to
the three UI composables above. The connected-mode and onboarding UI lives alongside it:
`SignInWidget.vue`, `MeetPickerDialog.vue`, `SchedulePickerDialog.vue`, and `TutorialOverlay.vue`.

Notable patterns:

* **Column enter animation**: new columns get `col--entering` class, removed on next double-rAF to
  trigger CSS width transition.
* **Cell selector popup**: teleported to `<body>` to avoid table overflow clipping.
* **Crosshair highlight**: `hoverCol` ref + `:hover` on quizzer name cell.
