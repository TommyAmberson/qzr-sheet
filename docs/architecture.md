# Architecture Reference

This document covers the scoresheet app (`apps/scoresheet/`). For the overall monorepo architecture,
API stack, and Phase 4 design, see [auth-proposal.md](./auth-proposal.md).

## Data Flow

```
quizStore  (plain objects, no Vue)
    │
    ▼
useScoresheet  (Vue composable — reactivity layer)
    │   ├── cells: CellValue[][][]            from store.cellGrid()
    │   ├── scoring: TeamScoring[]            from scoreTeam()
    │   ├── greyedOutResult: GreyedOutResult  from computeGreyedOut()
    │   ├── validationErrors: Map<key, codes> from validateCells()
    │   ├── visibleColumns: VisibleColumn[]   from computeVisibleColumns()
    │   ├── placements: (number|null)[]       from computePlacements()
    │   └── undo/redo                         via useHistory()
    │
    ▼
Scoresheet.vue  (single component, delegates to UI composables)
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

## Core Types (`src/types/scoresheet.ts`)

* **`CellValue`** — enum: `Correct | Error | Foul | Bonus | MissedBonus | Empty`
* **`Column`** — `{ key, label, number, type, isAB, isErrorPoints, isOvertime }`
* **`Quiz`** — metadata: division, quizNumber, overtime toggle, placementFormula, questionTypes
* **`Team`** — name, onTime, seatOrder
* **`Quizzer`** — name, teamId, seatOrder
* **`PlacementFormula`** — enum: `Rules` (official rulebook) | `Legacy` (pre-2023 spreadsheet)
* **`PlaceKey`** — encodes rank + tie-width: `1`, `1.2`, `1.3`, `2`, `2.2`, `3`

Column keys: `"1"`–`"15"` (normal), `"16"`/`"16A"`/`"16B"` through `"20B"` (A/B), `"21"`+
(overtime).

## Store (`src/stores/quizStore.ts`)

Plain factory function — **no singleton, no Vue reactivity**. Creates a fresh store per call.

* Answers stored in a `Map<"quizzerId:columnKey", Answer>` for O(1) lookup.
* `cellGrid(columns)` derives the `CellValue[][][]` grid on demand.
* `moveQuizzer()` does an insert (not a swap) and reassigns `seatOrder`.

## Scoring (`src/scoring/`)

All scoring functions are **pure functions** — they take `CellValue[][][]` and `Column[]` and return
results. No Vue, no store access.

| File                  | Responsibility                                                               |
| --------------------- | ---------------------------------------------------------------------------- |
| `scoreTeam.ts`        | Per-team score, running totals, per-quizzer stats                            |
| `greyedOut.ts`        | Which cells are disabled (answered, toss-up, foul cascade)                   |
| `columnVisibility.ts` | Which columns render; orphaned column detection                              |
| `validation.ts`       | `ValidationCode` enum, `validateCells()` — all rule violations               |
| `overtime.ts`         | OT eligibility, round count, checkpoint scores                               |
| `placement.ts`        | Progressive 1st/2nd/3rd placement derivation                                 |
| `helpers.ts`          | Pure cell-grid queries (`teamHasValue`, `isResolved`, `isBonusSituation`, …) |

### Cell grid indexing

```
cells[teamIdx][quizzerIdx][colIdx]
```

`teamIdx` and `quizzerIdx` are positional (sorted by `seatOrder`), not IDs. Column index matches
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

The only place Vue reactivity lives for scoring state. Wraps the store and scoring functions with
`ref`/`computed`.

Key reactive dependencies:

* `answerVersion` — bumped on every `setCell()` to invalidate `cells` computed
* `teamVersion` — bumped on name/seat changes to invalidate `teams` computed
* `internalOtRounds` — grows when `visibleOtRounds` needs more; never shrinks within a session

`columns` is derived from `quiz.overtime` + `internalOtRounds`. All scoring/greyout/validation
computeds depend on `columns` and `cells`.

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

### `fileIO.ts`

Platform-aware file I/O. Detects Tauri via `__TAURI_INTERNALS__` and uses the native dialog/fs
plugins; falls back to `showSaveFilePicker` (Chrome) then `<a>` download for web.

Exports: `saveQuizToFile`, `openAnyQuizFile` (handles `.json` and `.ods`), `exportOdsFile`,
`openOtsTemplate`, `confirmAction`.

### `autoSave.ts`

Debounced (300 ms) `saveToStorage` writes serialized state to `localStorage`. `loadFromStorage`
returns the saved state on startup; `clearStorage` is called on New Quiz / Reset.

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

## Component (`src/components/Scoresheet.vue`)

Single `.vue` file. Reads from `useScoresheet()` and delegates interaction to the three UI
composables above.

Notable patterns:

* **Column enter animation**: new columns get `col--entering` class, removed on next double-rAF to
  trigger CSS width transition.
* **Cell selector popup**: teleported to `<body>` to avoid table overflow clipping.
* **Crosshair highlight**: `hoverCol` ref + `:hover` on quizzer name cell.
