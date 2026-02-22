# Cleanup Roadmap

Findings from a full codebase review. Each phase is independent enough to be
tackled in a single session. Phases are ordered by impact/dependency — earlier
phases make later ones easier.

---

## Phase 1 — Relational data model

**Problem:** Data lives in a positional 3D array (`cells[teamIdx][quizzerIdx][colIdx]`).
This is fragile (reordering breaks it), hard to serialize, and couples storage
to rendering order. The types file already has unused `Question` and `Answer`
interfaces that hint at a relational design that was never wired up.

**Data model:**
```
Quiz     { id, division, quizNumber, overtime }
Team     { id, quizId, name, onTime, seatOrder }
Quizzer  { id, teamId, name, seatOrder }
Answer   { quizzerId, columnKey, value }        ← associative table
```

- `timeouts` removed from `Team` for now (future feature).
- `noJump` is per-question, stored on the column runtime state (not persisted
  as a separate entity — it's quiz-level metadata).
- Columns are static and built once (`COLUMNS` / `KEY_TO_IDX` constants).

**Migration strategy (Option A — adapter layer):**
- Source of truth becomes the relational entities + `Answer[]`.
- A computed property materializes `CellValue[][][]` from answers for the
  scoring functions. Scoring/greyedOut/validation stay unchanged.
- `setCell` writes to the `Answer` map; the grid is derived.

**Changes:**
- Update `types/scoresheet.ts`: clean up `Team`, `Quizzer`, `Answer`;
  remove unused `Question`; export `COLUMNS` and `KEY_TO_IDX` constants.
- Write tests for a data store that manages entities and derives the grid.
- Build the store, adapt `useScoresheet` to use it.
- Existing scoring/greyedOut/validation tests must pass unchanged.

**Risk:** Medium — touches the core data flow, but scoring functions are
insulated by the adapter layer.

---

## Phase 2 — Shared helpers & deduplication

**Problem:** Three files (`greyedOut.ts`, `validation.ts`, `Scoresheet.vue`)
each independently implement the same helpers: `anyTeamHasValue`,
`teamHasAnswer`, bonus-situation detection, resolved-question checks, and
`keyToIdx` map construction.

**Changes:**
- Create `scoring/helpers.ts` with shared pure functions:
  `anyTeamHasValue`, `teamHasAnswer`, `anyTeamHasAnswer`,
  `isBonusSituation`, `isQuestionResolved`.
- Update `greyedOut.ts`, `validation.ts`, `Scoresheet.vue` to import from
  helpers instead of re-implementing.

**Risk:** Low — pure refactor, existing tests cover correctness.

---

## Phase 3 — Move business logic out of Scoresheet.vue

**Problem:** `Scoresheet.vue` is ~600 lines mixing scoring logic, animation
state, and rendering. Functions like `isBonusForTeam`, `abColumnNeeded`,
`colAnswerValue`, `isAfterOut`, `noJumpHasConflict` are business logic that
belong in the composable or scoring layer, not in a component.

**Changes:**
- Move `isBonusForTeam`, `colAnswerValue`, `abColumnNeeded`,
  `colHasAnyContent`, `isAfterOut`, `isFouledOnQuestion`, `noJumpHasConflict`,
  `teamHasErrors` into `useScoresheet.ts` (or helpers). Expose as return
  values or computed properties.
- `Scoresheet.vue` should only do rendering, event handling, and UI state
  (selector popup, animation).
- Consider splitting into sub-components later (TeamBlock, QuizzerRow,
  CellSelector) but that's optional — getting logic out is the priority.

**Risk:** Low — logic moves, no behavior change.

---

## Phase 4 — Simplify validation by leveraging greyedOut

**Problem:** `validateCells` re-derives "is this question resolved?" by
scanning parent columns for `Correct/Bonus/MissedBonus` — the exact same
work `computeGreyedOut` already did. The `QuestionResolved` validation code
is essentially "does this cell fall in a column that greyedOut disabled due to
A/B cascade?"

**Changes:**
- Have `computeGreyedOut` return a `cascadeDisabled: Set<string>` (columns
  disabled by parent resolution, separate from "question answered" disabling).
- `validateCells` checks `cascadeDisabled` instead of re-scanning parents.
- Remove duplicated `anyTeamHasValue` / resolved logic from `validation.ts`
  (already consolidated in Phase 2 helpers).

**Risk:** Low-medium — needs careful test verification but the greyed-out
tests already cover the cascade logic thoroughly.

---

## Phase 5 — Replace string-key Sets with flat arrays

**Problem:** `greyedOut` and `validation` use `Set<string>` with keys like
`"0:2:15"` and `"1:42"`. Every recompute allocates hundreds of string
concatenations. For a reactive system that recomputes on every cell click,
this creates unnecessary GC pressure.

**Changes:**
- For `disabled` / `tossedUp`: use `boolean[]` of size
  `teamCount × colCount`, indexed as `ti * colCount + ci`.
- For `fouledQuizzers`: use `boolean[]` of size
  `teamCount × quizzerCount × colCount`, indexed as
  `ti * quizzerCount * colCount + qi * colCount + ci`.
- For `validationErrors`: use `Map<number, ValidationCode[]>` with numeric
  keys, or a flat array.
- Add index-helper functions: `disabledIdx(ti, ci)`,
  `fouledIdx(ti, qi, ci)`, etc.

**Risk:** Medium — touches every call site. Run full test suite after.

---

## Phase 6 — Persistence

**Problem:** No save/load at all. Page refresh loses everything. The Tauri
backend is an empty shell.

**Approach:** Store the relational model (from Phase 1) as JSON via
localStorage or `tauri-plugin-store`. Not SQLite — just the relational
*shape* serialized as JSON. This page is one quiz at a time; multi-quiz
save/load is a future feature.

**Persistence shape:**
```ts
interface SavedQuiz {
  version: number
  quiz: Quiz
  teams: Team[]
  quizzers: Quizzer[]
  answers: Answer[]
  noJumps: string[]          // columnKeys with noJump set
}
```

**Changes:**
- Add save/load functions to `useScoresheet.ts`.
- Auto-save on cell/meta changes (debounced).
- Load on composable init, fall back to defaults.
- Add a "New Quiz" / "Reset" action that clears saved state.

**Risk:** Low — additive feature, no logic changes.

---

## Phase 7 — Column animation cleanup (optional)

**Problem:** The `displayColumns` / `watch` / `setTimeout` pattern for
column enter/leave animations is brittle. Two changes within 350ms can
conflict — the second `setTimeout` callback may remove columns that a newer
animation still needs.

**Changes:**
- Replace with Vue's `<TransitionGroup>` on the column `<th>`/`<td>`
  elements, using CSS transitions on `max-width` + `padding`.
- Remove `displayColumns`, `enteringCols`, `leavingCols` refs and the
  entire `watch(visibleColumns, ...)` block.

**Risk:** Medium — visual-only change but needs manual testing across
browsers. `<TransitionGroup>` on table cells can be quirky.

---

## Notes

- **Test-first preference:** Write tests before implementation for each
  phase where possible. For Phases 2-5, the existing test suite should be
  sufficient — run it after each change. For Phase 1 and 6, write new
  tests for the data store and serialization before implementing.
- **Scoring logic is solid:** `scoreTeam.ts` is clean and well-tested. No
  changes needed to the core algorithm. The relational model in Phase 1
  uses an adapter layer so scoring functions are insulated.
- **No Tauri commands yet:** The Rust backend has no commands. Phase 6 may
  or may not need Tauri commands depending on the persistence approach
  chosen (localStorage needs none, tauri-plugin-store needs minimal setup).
