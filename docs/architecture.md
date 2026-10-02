# Architecture Reference

This document covers the scoresheet app (`apps/scoresheet/`) and the overall monorepo structure. For
auth implementation see [auth.md](./auth.md). For roles and codes see
[roles-and-access.md](./roles-and-access.md). For the database schema see
[data-model.md](./data-model.md).

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
`apps/web/wrangler.toml`. Its script serves each app's shell on an asset miss. `qzr-api` answers
under `/qzr/api/` and, until switch day, `/api/` too; the more specific route wins over `/qzr/*`.

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
and is taken to `/qzr/scoresheet/?quiz=abc123`. The scoresheet reads the session and quiz ID from
the URL, then auto-fetches and pre-populates.

| Path                        | Flow                                                           |
| --------------------------- | -------------------------------------------------------------- |
| Portal → click quiz         | Opens `/qzr/scoresheet/?quiz=abc`, session already established |
| Scoresheet → sign in → load | OAuth flow, pick from list in a modal, same end state          |

## Shared Package (`packages/shared`)

Contract package consumed by both frontend apps and the API (see "Contract package versioning" in
`CONTRIBUTING.md`):

* `QuizFile` TypeBox schema, `FILE_VERSION`, and its enums (`PlacementFormula`, `BonusRule`,
  `QuizFormat`, `CellValue`, `QuestionCategory`)
* Role enums (`AccountRole`, `MeetRole`) and meet phase / division state constants
* `createApiClient` + `ApiError`, the fetch wrapper both apps construct with their own base URL
* `createAppAuthClient`, the Better Auth client factory returning `{ authClient, useAuth }`

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
useScoresheet  ──setCell/toggleNoJump──▶  autoSave  ──▶  localStorage
               ◀─────────────────────── loadFromStorage (on startup)

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
(overtime). For a 15-question quiz: `"1"`–`"10"`, `"11"`/`"11A"`/`"11B"` through `"15B"`, `"16"`+
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
placement. `openedFromNewerFile` marks a quiz opened through the try-anyway path, and
`keptNewerAutoSaves` lists the keys of set-aside newer auto-saves, with `openKeptNewerAutoSave` and
`discardKeptNewerAutoSave` acting on the first listed.

### `useHistory.ts`

Generic command stack (undo/redo). Capped at 100 entries by default. `setCell` and `toggleNoJump` in
`useScoresheet` push commands here.

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

Debounced (300 ms) `saveToStorage` writes serialized state to `localStorage`. `loadFromStorage`
returns the saved state on startup; `clearStorage` is called on New Quiz / Reset. An auto-save from
a newer version is never deleted: it moves to its own `qzr-sheet:newer-autosave:<timestamp>` key
(`listKeptNewerAutoSaves`, `readKeptNewerAutoSave`, `discardKeptNewerAutoSave`), and the sheet
offers to try opening it. If storage is too full to move it, it stays where it is, listed first, and
auto-save pauses until it is discarded. The tutorial's crash snapshot from a newer version is set
aside the same way, or kept in place (`keepNewerInPlace`). While anything is kept in place the
tutorial won't start (a deliberate trade-off), and while auto-save is paused crash recovery leaves
its own snapshot until auto-save resumes and saves the quiz (`removeOnceSaved`; full-disk save
failures aren't detected, #92). `persistence/openedFromNewerFile.ts` persists the "may be scored
wrong" warning across reloads.

## Export (`src/export/`)

### `fillOts.ts`

Opens a user-supplied `.ots`/`.ods` template as a ZIP, patches the `Quiz` sheet at known fixed cell
addresses with the current quiz data, and returns the modified bytes. All other sheets pass through
unchanged so the template's formulas recalculate in LibreOffice.

### `readOds.ts`

Parses a filled `.ods` file and maps the fixed cell addresses back into store format (teams,
quizzers, answers, no-jumps, question types, metadata). Infers A/B column depth from error counts
when footer rows are empty.

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
