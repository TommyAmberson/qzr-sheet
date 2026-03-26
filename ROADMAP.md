# Roadmap

### Phase 0: Foundation (Complete)

#### 0.1 Tauri 2 + Vue 3 + Vite template ✅

Project scaffolding with Tauri 2 backend and Vue 3 + Vite frontend.

#### 0.2 Native dev environment ✅

`pnpm tauri dev` for hot-reload development in the native window.

### Phase 1: Core UI

#### 1.1 Table layout ✅

Sticky name column, question headers (1–20 + overtime 21–26), three team blocks of five quizzers
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

#### 1.11 Placement points

Calculate and display placement points after quiz completion — 1st gets `score/10` (min 10), 2nd
`score/10 − 1` (min 5), 3rd `score/10 − 3` (min 1).

#### 1.12 Individual quizzer scores

Show each quizzer's individual point total at the end of their row.

#### 1.13 Question type dropdown

Beneath the No Jump row, a dropdown to set the question type (INT, MA, etc.).

### Phase 1.5: Optional Core UI features

#### 1.5.1 Tablet-optimized touch targets

Larger hit areas and touch-friendly spacing for use during live quizzes.

#### 1.5.2 Drag-drop quizzer reordering ✅

Drag quizzer rows to reorder within a team, updating seat order in the store.

#### 1.5.3 Hidden A/B question columns ✅

A/B columns only appear when needed (already implemented with animation).

#### 1.5.4 Keyboard navigation

Arrow keys between cells, Enter to open selector, letter keys to set values directly.

#### 1.5.5 Undo/redo

History stack for cell changes with Ctrl+Z / Ctrl+Shift+Z.

### Phase 2: Data Management

#### 2.1 Save/load as JSON

Persist quiz state to localStorage or `tauri-plugin-store`. Load on startup, fall back to defaults.

#### 2.2 Auto-save

Debounced save on every cell change, name edit, or metadata toggle.

#### 2.3 New Quiz / Reset

Clear saved state and reinitialize with blank defaults. Confirmation prompt.

#### 2.4 ODS/LibreOffice export

Export the scoresheet as an ODS spreadsheet matching the physical layout.

#### 2.5 Print-friendly layout

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
