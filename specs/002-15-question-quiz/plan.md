# Implementation Plan: 15-question quiz format

**Branch**: `feat/15-question-quiz` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-15-question-quiz/spec.md`

## Summary

Add a per-quiz format, 20-question or 15-question, chosen when a quiz starts. The 15-question format
is the 20-question structure moved five questions earlier (A/B from 11, error points from 12), with
quiz-out at 3 and overtime from 16. A new pure `quizRules(format)` table replaces every structural
literal in scoring, column building, overtime, visibility, validation, and the timeout check, and
functions take the rules as a required parameter so the type checker finds every call site. The
format is stored on the quiz and in `QuizFile`. Files record the version needed to read them:
20-question quizzes still save as version 2, readable by older installs, and 15-question quizzes
save as version 3, which older installs refuse instead of misscoring. From this release on, a file
newer than the build can be opened on request with a warning. ODS export is disabled for 15-question
quizzes. See [research.md](./research.md) for each decision.

## Technical Context

**Language/Version**: TypeScript 5 on Node >=22.12.0

**Primary Dependencies**: Vue 3, Vite, Tauri 2, `@sinclair/typebox` (QuizFile schema)

**Storage**: quiz `.json` files and `localStorage` auto-save, both `QuizFile`. No D1 change.

**Testing**: Vitest (`pnpm test:unit`), `vue-tsc` (`pnpm type-check`), ESLint (`pnpm lint`)

**Target Platform**: scoresheet PWA in browsers; Tauri desktop and Android

**Project Type**: pnpm monorepo; this feature touches `packages/shared` and `apps/scoresheet`

**Performance Goals**: none new; scoring stays synchronous and per keystroke as today

**Constraints**: offline-first (principle I); scoring stays pure (principle III); files must not be
misread by installs that cannot be updated

**Scale/Scope**: about 15 source files, their specs, 4 docs, 3 changelogs

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                       | Gate                                                                                                                                                                                                                                  | Pass when           | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I   | Offline, always                 | Can an official still score, auto-save, and save/load a quiz with the API down? Can any load path drop scores silently?                                                                                                               | yes, then no        | **Yes, then no.** No network involved. Older installs refuse 15-question files (version 3) rather than misscore them; 20-question files stay version 2. Newer-than-build files open only on explicit consent, with a warning badge. A newer auto-save is kept under its own key and offered back, never deleted (FR-018); auto-save pauses only if storage is too full to move it (see Complexity Tracking). Pre-existing: other unreadable auto-saves are still deleted, and `deserialize` drops unknown column keys; neither is widened. |
| II  | Rulebook is the spec            | Does the feature change scoring, scheduling, auth, roles, or the data model? If so, which doc in `docs/` is amended, and does any new rulebook departure arrive as an opt-in setting documented in `docs/scoring-rules-explained.md`? | doc named, or N/A   | **Changes scoring.** `docs/scoring-rules-explained.md` gains the 15-question rules and a "Rules not in the rulebook" section (FR-014). The format is opt-in per quiz; 20-question stays the default. `docs/architecture.md` updated for `quizRules.ts` and file versions.                                                                                                                                                                                                                                                                  |
| III | One pure scoring implementation | Does anything outside `apps/scoresheet/src/scoring/` (or `packages/shared`, once moved) compute a score, validation, grey-out, visibility, overtime, or placement?                                                                    | no                  | **No.** `quizRules.ts` lives in `scoring/`. `useScoresheet` passes rules in; `Scoresheet.vue` reads derived results and the shared validation message. The timeout check in `useScoresheet` reads `lastTimeoutQuestion(rules)` rather than its own literal.                                                                                                                                                                                                                                                                                |
| IV  | Meet data gated per meet        | Does every new or changed API route touching a meet's data check membership, a guest token for that meet, or superuser? Is any new token or session scheme introduced?                                                                | yes, then no        | **N/A.** No API routes or tokens change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| V   | Contract versions               | Does it touch `packages/shared/src/`? If so, which semver level, is the bump in the same commit, and does it change `FILE_VERSION`?                                                                                                   | level named, or N/A | **MAJOR, 0.10.0 to 1.0.0**, in the same commit as the schema change, marked breaking and unscoped, `feat!:`, as it also touches the scoresheet. `FILE_VERSION` 2 to 3. See [contracts/quiz-file.md](./contracts/quiz-file.md).                                                                                                                                                                                                                                                                                                             |
| VI  | Validate before merge           | Are scoring and validation changes covered by unit tests in `__tests__/`? Is every D1 schema change shipped as a migration from `db:generate`?                                                                                        | yes, or N/A         | **Yes; no D1 change.** Tests listed under Testing below, written before each change.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -   | Technology constraints          | Does it add a package or deployable, a cross-origin production client, or HTML5 drag?                                                                                                                                                 | no, or justified    | **No.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Post-design re-check: unchanged. The design artefacts add no route, package, or scoring path outside
`scoring/`.

## Project Structure

### Documentation (this feature)

```text
specs/002-15-question-quiz/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1 to R12, plus R2a
├── data-model.md        # Phase 1: QuizFormat, Quiz.format, QuizRules, column keys
├── quickstart.md        # Phase 1: validation run guide
├── contracts/
│   └── quiz-file.md     # Phase 1: file versioning contract
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared/
├── src/quizFile.ts                  # QuizFormat enum, quiz.format, version 1|2|3, FILE_VERSION 3
├── package.json                     # 0.10.0 -> 1.0.0
└── CHANGELOG.md

apps/scoresheet/src/
├── scoring/
│   ├── quizRules.ts                 # NEW: QuizRules, quizRules(format), derived helpers
│   ├── scoreTeam.ts                 # quiz-out threshold from rules
│   ├── validation.ts                # quiz-out from rules; TimeoutAfterErrorPoints code + message
│   ├── overtime.ts                  # 20/21 literals -> rules
│   ├── columnVisibility.ts          # 20 + rounds * 3 -> rules
│   ├── placement.ts                 # doc comment only
│   └── __tests__/                   # quizRules.spec.ts NEW; others gain 15-question cases
├── types/scoresheet.ts              # Quiz.format; buildColumns(rules, overtimeRounds)
├── stores/quizStore.ts              # default format; loadState copies format
├── persistence/
│   ├── quizFile.ts                  # serialize version-needed-to-read; deserialize by format;
│   │                                #   newer-version detection and attempt mode
│   ├── autoSave.ts                  # kept newer auto-saves: set aside, or kept in place + pause
│   ├── openedFromNewerFile.ts       # NEW: persisted "may be scored wrong" flag
│   └── __tests__/                   # round trips, version rules, attempt mode, kept auto-saves
├── composables/useScoresheet.ts     # rules computed; resetStore(format); timeout cutoff; openFile;
│                                    #   newer-file flag; kept auto-save open/discard
├── composables/useTutorial.ts       # carries the newer-file flag; sets aside newer snapshots
├── components/Scoresheet.vue        # New menu items, format badge, newer-file badge, ODS disable,
│                                    #   round-boundary and OT styling from rules
├── export/readOds.ts, fillOts.ts    # explicit 20-question rules
└── App.vue                          # Ctrl+N repeats current format

docs/scoring-rules-explained.md, docs/architecture.md, CLAUDE.md, CONTRIBUTING.md
apps/web/src/views/RoadmapView.vue
apps/scoresheet/CHANGELOG.md, apps/scoresheet/package.json (0.11.1 -> 0.12.0)
apps/web/CHANGELOG.md, apps/web/package.json (0.12.1 -> 0.12.2)
```

**Structure Decision**: existing monorepo layout; no new package. Two new modules,
`apps/scoresheet/src/scoring/quizRules.ts` and
`apps/scoresheet/src/persistence/openedFromNewerFile.ts`.

## Implementation Order

Each step is one or more atomic commits that build and pass tests on their own.

1. **Rules table, no behaviour change.** Add `quizRules.ts` with the `QuizRules` type and a
   `TWENTY_QUESTION_RULES` constant, thread `rules` through `buildColumns` and the scoring functions
   as a required parameter, and replace the literals. Existing specs gain a `TWENTY` argument and
   pass unchanged. Commit as a refactor; it touches no `packages/shared/src/`. `quizRules(format)`
   arrives in step 3, once the enum exists.
2. **Shared contract.** `QuizFormat`, optional `quiz.format`, version union 1|2|3,
   `FILE_VERSION = 3`, shared 1.0.0, shared changelog. One commit, `feat!:` (unscoped: it spans
   packages), which also adds the scoresheet's `fileVersionFor(format)` so no intermediate commit
   stamps a 20-question file with version 3.
3. **15-question rules.** Add the `FifteenQuestion` row with its specs: columns, quiz-out, bonus
   values, error points, overtime start, visibility, timeouts, validation.
4. **Store and persistence.** `Quiz.format`, `loadState` copy, serialize at the version needed to
   read, deserialize by format, unknown-format and newer-version errors, attempt mode, kept newer
   auto-saves.
5. **UI.** New menu items, `resetStore(format)`, Ctrl+N, format badge, newer-file prompt and badge,
   ODS export disabled, round-boundary and overtime styling from rules, timeout message.
6. **Docs.** Scoring rules reference (with "Rules not in the rulebook"), architecture, CLAUDE.md,
   RoadmapView.
7. **Release, with the change.** Per CONTRIBUTING.md, the first observable scoresheet commit (US1)
   bumps the scoresheet to 0.12.0 and adds its dated changelog section, with `### Bundled contract`
   naming `@qzr/shared@1.0.0`; later commits add lines to that section. The roadmap entry in
   `apps/web` bumps web to 0.12.2 the same way. A final check confirms the sections are complete.

## Testing

Written before each change (principle VI), in the `__tests__/` beside the code:

* `quizRules.spec.ts`: both rows; invariants; 20-question row equals today's literals.
* `types` column tests: 15-question layout, keys, `isAB` from 11, `isErrorPoints` from 12, overtime
  from 16.
* `scoreTeam.spec.ts`: quiz-out and its bonus at 3; bonus +20 at 11, +10 at 12; first error free at
  11, costs 10 at 12.
* `validation.spec.ts`: quizzed out at 3; timeout message code renamed.
* `overtime.spec.ts`, `columnVisibility.spec.ts`: regulation complete at 15; first round 16 to 18;
  second round only while tied.
* `quizFile.spec.ts`: 20-question saves as version 2 without `format`; 15-question saves as version
  3 with it; version 1 and 2 files load as 20-question, and fail if they name a format; version 3
  without `format` fails; unknown format fails naming it; version 4 is detected as newer; attempt
  mode loads it and drops unknown fields; `16A` is overtime in a 15-question file.
* `placement.spec.ts`: 15-question placements use only end-of-Q15 scores, even with overtime.
* A full hand-scored 15-question reference quiz (SC-002).
* `autoSave.spec.ts`: a newer auto-save is moved to its own key, never deleted or overwritten.
* `quizStore.spec.ts`: `loadState` copies `format`.
* `useScoresheet.spec.ts`: `resetStore(format)`; `clearAnswers` keeps format; timeout cutoff per
  format.
* Every existing 20-question spec passes (SC-003).

## Open Items Surfaced (outside this feature)

* `quizStore.loadState` does not copy `bonusRule`, so a loaded file's bonus rule is ignored: #78.
* `deserialize` drops answers in unknown column keys. Investigated: every producer (`serialize`,
  `readOds`, auto-save) writes keys inside the accepted range, so only a hand-edited or corrupt file
  is affected. Not filed.

## Complexity Tracking

| Violation                                                                                                                                           | Why Needed                                                                                                                                                                                                                                                                                                                                                                         | Simpler Alternative Rejected Because                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Principle I: auto-save pauses while a newer auto-save that couldn't be set aside still sits under `qzr-sheet:current` (contract, "Newer auto-save") | The next auto-save would overwrite that quiz, the silent loss principle I forbids. The pause only happens when storage is too full to hold a second copy; overwriting the existing key would still succeed, and that is the loss it prevents. Explicit file save and load stay available, the notice says auto-save is paused, and Discard resumes it and saves the sheet at once. | Keep auto-saving: overwrites the newer quiz. Delete it to make room: silent loss. Save the sheet under another key: storage can't hold it. |
