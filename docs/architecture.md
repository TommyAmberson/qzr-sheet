# Architecture Reference

## Data Flow

```
quizStore  (plain objects, no Vue)
    │
    ▼
useScoresheet  (Vue composable — reactivity layer)
    │   ├── cells: CellValue[][][]          from store.cellGrid()
    │   ├── scoring: TeamScoring[]          from scoreTeam()
    │   ├── greyedOutResult: GreyedOutResult from computeGreyedOut()
    │   ├── validationErrors: Map<key, codes> from validateCells()
    │   ├── visibleColumns: VisibleColumn[] from computeVisibleColumns()
    │   └── placements: (number|null)[]     from computePlacements()
    │
    ▼
Scoresheet.vue  (single component, reads composable only)
```

## Core Types (`src/types/scoresheet.ts`)

- **`CellValue`** — enum: `Correct | Error | Foul | Bonus | MissedBonus | Empty`
- **`Column`** — `{ key, label, number, type, isAB, isErrorPoints, isOvertime }`
- **`Quiz`** — metadata: division, quizNumber, overtime toggle
- **`Team`** — name, onTime, seatOrder
- **`Quizzer`** — name, teamId, seatOrder

Column keys: `"1"`–`"15"` (normal), `"16"`/`"16A"`/`"16B"` through `"20B"` (A/B), `"21"`+ (overtime).

## Store (`src/stores/quizStore.ts`)

Plain factory function — **no singleton, no Vue reactivity**. Creates a fresh store per call (important for tests — call `resetIdCounter()` before each test suite).

- Answers stored in a `Map<"quizzerId:columnKey", Answer>` for O(1) lookup.
- `cellGrid(columns)` derives the `CellValue[][][]` grid on demand.
- `moveQuizzer()` does an insert (not a swap) and reassigns `seatOrder`.

## Scoring (`src/scoring/`)

All scoring functions are **pure functions** — they take `CellValue[][][]` and `Column[]` and return results. No Vue, no store access.

| File | Responsibility |
|------|---------------|
| `scoreTeam.ts` | Per-team score, running totals, per-quizzer stats |
| `greyedOut.ts` | Which cells are disabled (answered, toss-up, foul cascade) |
| `columnVisibility.ts` | Which columns render; orphaned column detection |
| `validation.ts` | `ValidationCode` enum, `validateCells()` — all rule violations |
| `overtime.ts` | OT eligibility, round count, checkpoint scores |
| `placement.ts` | Progressive 1st/2nd/3rd placement derivation |
| `helpers.ts` | Pure cell-grid queries (`teamHasValue`, `isResolved`, `isBonusSituation`, …) |

### Cell grid indexing

```
cells[teamIdx][quizzerIdx][colIdx]
```

`teamIdx` and `quizzerIdx` are positional (sorted by `seatOrder`), not IDs.
Column index matches position in the `columns` array from `buildColumns()`.

### Grey-out vs. validation

- **Grey-out** (`computeGreyedOut`) — visual state only. Prevents interaction. Does not flag data as wrong.
- **Validation** (`validateCells`) — flags existing data as invalid. Drives the pulsing red outline and tooltips.

A cell can be greyed without being invalid (e.g. a question already answered — the empty cells are just greyed).
A cell can be invalid without being greyed (e.g. an answer recorded on a toss-up column the team shouldn't have jumped on).

## Composable (`src/composables/useScoresheet.ts`)

The only place Vue reactivity lives. Wraps the store and scoring functions with `ref`/`computed`.

Key reactive dependencies:
- `answerVersion` — bumped on every `setCell()` to invalidate `cells` computed
- `teamVersion` — bumped on name/seat changes to invalidate `teams` computed
- `internalOtRounds` — grows when `visibleOtRounds` needs more; never shrinks within a session

`columns` is derived from `quiz.overtime` + `internalOtRounds`. All scoring/greyout/validation computeds depend on `columns` and `cells`.

## Component (`src/components/Scoresheet.vue`)

Single large component — all UI in one file. Reads exclusively from `useScoresheet()`.

Notable patterns:
- **Column enter animation**: new columns get `col--entering` class, removed on next double-rAF to trigger CSS width transition.
- **Drag reorder**: pointer events only (no HTML5 drag API — avoids Linux/X11 crashes). Hit-testing done manually against registered row element rects.
- **Cell selector popup**: teleported to `<body>` to avoid table overflow clipping.
- **Crosshair highlight**: `hoverCol` ref + `:hover` on quizzer name cell.
