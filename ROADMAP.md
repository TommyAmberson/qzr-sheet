# Roadmap

### Phase 0: Foundation (Complete)

#### Tauri 2 + Vue 3 + Vite template ✅
Project scaffolding with Tauri 2 backend and Vue 3 + Vite frontend.

#### Native dev environment ✅
`pnpm tauri dev` for hot-reload development in the native window.

### Phase 1: Core UI

#### Table layout ✅
Sticky name column, question headers (1–20 + overtime 21–26), three team
blocks of five quizzers each, running total row per team.

#### Cell selector ✅
Click a cell to open a context-aware popup — C/E/F on normal columns,
B/MB/F on bonus columns or bonus situations.

#### Live scoring ✅
Running totals, team totals, per-quizzer stat badges (quiz-out, error-out,
foul-out, correct/error/foul counts), and running total annotations
(3rd/4th/5th quizzer bonus, quizout bonus, free error, foul deduction).

#### Question highlighting ✅
Column headers change color based on the answer state — green for correct,
red for error, teal for bonus, grey strikethrough for no-jump.

#### Greyed-out cells ✅
Cells are visually disabled for answered questions, toss-up teams,
after-out quizzers, and fouled-on-question situations.

#### A/B question columns ✅
A and B sub-columns for questions 16–20 auto show/hide based on errors,
with a smooth enter animation.

#### Overtime columns (started - not working correctly)
Questions 21–26 toggle via the overtime checkbox in quiz metadata.

#### Validation ✅
Invalid cells pulse red and the team total highlights. Checks for duplicate
answers, toss-up violations, wrong cell types, quizzer-out, and more.

#### Validation explanation
Invalid cells pulse red but the user can't see *why*. Show the reason in a
tooltip (e.g. "Team is tossed up", "Quizzer has quizzed out").

#### Editable team/quizzer names
Replace hardcoded "Team 1" / "Quizzer 1" with inline-editable text fields.

#### Placement points
Calculate and display placement points after quiz completion — 1st gets
`score/10` (min 10), 2nd `score/10 − 1` (min 5), 3rd `score/10 − 3` (min 1).

#### Individual quizzer scores
Show each quizzer's individual point total at the end of their row.

### Phase 1.5: Optional Core UI features

#### Tablet-optimized touch targets
Larger hit areas and touch-friendly spacing for use during live quizzes.

#### Drag-drop quizzer reordering
Drag quizzer rows to reorder within a team, updating seat order in the store.

#### Hidden A/B question columns ✅
A/B columns only appear when needed (already implemented with animation).

#### Keyboard navigation
Arrow keys between cells, Enter to open selector, letter keys to set values
directly.

#### Undo/redo
History stack for cell changes with Ctrl+Z / Ctrl+Shift+Z.

### Phase 2: Data Management

#### Save/load as JSON
Persist quiz state to localStorage or `tauri-plugin-store`. Load on startup,
fall back to defaults.

#### Auto-save
Debounced save on every cell change, name edit, or metadata toggle.

#### New Quiz / Reset
Clear saved state and reinitialize with blank defaults. Confirmation prompt.

#### ODS/LibreOffice export
Export the scoresheet as an ODS spreadsheet matching the physical layout.

#### Print-friendly layout
CSS print styles that hide UI chrome and format for A4/letter paper.

### Phase 3: Quizmeet Integration

#### Load teams/quizzers from API
Pull team rosters and quizzer names from the quizmeet API.

#### Submit results
Push completed scores and placement points back to quizmeet.

#### Admin dashboard
View upcoming quizzes, assign scorekeepers, review submitted results.

### Phase 4: Distribution

#### Packaged releases
Platform-specific installers (.exe, .app, .deb, .rpm) via GitHub Releases.

#### Auto-updater
Tauri's built-in update mechanism for seamless version updates.

#### PWA / web deployment
Static web deployment with PWA manifest as a native app fallback.
