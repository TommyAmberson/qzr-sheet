# Roadmap

### Phase 0: Foundation (Complete)

#### 0.1 Tauri 2 + Vue 3 + Vite template ✅

Project scaffolding with Tauri 2 backend and Vue 3 + Vite frontend.

#### 0.2 Native dev environment ✅

`pnpm tauri dev` for hot-reload development in the native window.

#### 0.3 Tooling ✅

ESLint (typescript-eslint + eslint-plugin-vue), Prettier, pre-commit hooks, and GitHub Actions CI.

### Phase 1: Core UI

#### 1.1 Table layout ✅

Sticky name column, question headers (1–20 + overtime rounds), three team blocks of five quizzers
each, running total row per team.

#### 1.2 Cell selector ✅

Click a cell to open a context-aware popup — C/E/F on normal columns, B/MB/F on bonus columns or
bonus situations.

#### 1.3 Live scoring ✅

Running totals, team totals, per-quizzer stat badges (quiz-out, error-out, foul-out,
correct/error/foul counts), and running total annotations (3rd/4th/5th quizzer bonus, quizout bonus,
free error, foul deduction).

#### 1.4 Question highlighting ✅

Column headers change color based on the answer state — green for correct, red for error, teal for
bonus, grey strikethrough for no-jump.

#### 1.5 Greyed-out cells ✅

Cells are visually disabled for answered questions, toss-up teams, after-out quizzers, and
fouled-on-question situations.

#### 1.6 A/B question columns ✅

A and B sub-columns for questions 16–20 auto show/hide based on errors, with a smooth enter
animation.

#### 1.7 Overtime columns ✅

Overtime toggle enables/disables overtime columns. When disabled, no overtime logic at all. When
enabled, additional rounds appear if quiz is tied after being filled out.

#### 1.8 Validation ✅

Invalid cells pulse red and the team total highlights. Checks for duplicate answers, toss-up
violations, wrong cell types, quizzer-out, overtime eligibility, and more.

#### 1.9 Validation explanation ✅

Invalid cells pulse red with a native tooltip showing the reason(s). Question number headers also
pulse red when any cell in their column has a validation error.

#### 1.10 Editable team/quizzer names ✅

Replace hardcoded "Team 1" / "Quizzer 1" with inline-editable text fields.

#### 1.11 Placement points ✅

Calculate and display placement points after quiz completion. Uses the official rulebook formula
with friendly ties; pre-2023 legacy formula available via `PlacementFormula.Legacy`. Both formulas
support tied placements via PlaceKey (1.2, 1.3, 2.2). See `docs/scoring-rules-explained.md` for a
full comparison.

#### 1.12 Individual quizzer scores ✅

Show each quizzer's individual point total at the end of their row.

#### 1.13 Question type dropdown ✅

Question category selector (INT, FTV, REF, MA, Q, SIT) inline in each column header. Clicking
anywhere on the header opens the native dropdown. Type label shown beneath the question number at
70% opacity, inheriting the header colour.

### Phase 1.5: Optional Core UI features

#### 1.5.1 Tablet-optimized touch targets

Larger hit areas and touch-friendly spacing for use during live quizzes.

#### 1.5.2 Drag-drop quizzer reordering ✅

Drag quizzer rows to reorder within a team, updating seat order in the store.

#### 1.5.3 Hidden A/B question columns ✅

A/B columns only appear when needed (already implemented with animation).

#### 1.5.6 Custom question type dropdown

Replace the native `<select>` in column headers with a custom dropdown for centered options and
consistent cross-browser styling.

#### 1.5.4 Keyboard navigation ✅

Arrow keys move between cells (focus top-left cell if nothing focused). Enter/Space opens the cell
selector. Letter keys (c/e/f/b/m) set the value directly. Escape closes the selector or clears
focus. Hover shows grey crosshair borders; keyboard focus shows blue crosshair borders on the cell,
quizzer name, and question header. Blue focus always overrides grey hover. Focus ring persists while
the selector popup is open.

#### 1.5.5 Undo/redo ✅

History stack for cell and no-jump changes (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y). Undo/redo buttons in
the meta bar. Capped at 100 entries.

### Phase 2: Data Management

#### 2.1 Save/load as JSON ✅

TypeBox schema for the quiz file format. Save to disk via Ctrl+S / button (native dialog in Tauri,
`showSaveFilePicker` in Chrome, `<a>` download fallback). Open via Ctrl+O / button. Unsaved-changes
popup skipped when history is clean; dirty tracking via undo-stack identity.

#### 2.2 Auto-save ✅

Debounced (300ms) persist to `localStorage` on every cell change, name edit, metadata toggle, or
no-jump change. Restored on startup before computeds run. Reset clears storage.

#### 2.3 New Quiz / Reset ✅

Ctrl+N / button clears all state and localStorage. Confirmation prompt when there are unsaved
changes.

#### 2.4 ODS/LibreOffice export ✅

Export the scoresheet as an ODS spreadsheet by filling a user-supplied OTS/ODS template. Patches the
Quiz sheet cells at known fixed addresses; all other sheets pass through unchanged so the template's
formulas recalculate automatically in LibreOffice.

#### 2.5 ODS import

Import a filled ODS scoresheet back into the app. Read cell values from known Quiz sheet addresses
and populate the store (teams, quizzers, answers, no-jumps, question types, metadata).

#### 2.6 Print-friendly layout

CSS print styles that hide UI chrome and format for A4/letter paper.

### Phase 3: Quizmeet Integration

#### 3.1 Load teams/quizzers from API

Pull team rosters and quizzer names from the quizmeet API.

#### 3.2 Submit results

Push completed scores and placement points back to quizmeet.

#### 3.3 Admin dashboard

View upcoming quizzes, assign scorekeepers, review submitted results.

### Phase 4: Distribution

#### 4.1 Packaged releases

Platform-specific installers (.exe, .app, .deb, .rpm) via GitHub Releases.

#### 4.2 Auto-updater

Tauri's built-in update mechanism for seamless version updates.

#### 4.3 PWA / web deployment

Static web deployment with PWA manifest as a native app fallback.
