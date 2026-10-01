# Data Model: 15-question quiz format

Phase 1 output for [plan.md](./plan.md). No server or D1 change: the API stores nothing about quiz
formats today. Everything below lives in `packages/shared` and the scoresheet.

## QuizFormat (enum, `packages/shared/src/quizFile.ts`)

| Member            | Value           | Meaning                                   |
| ----------------- | --------------- | ----------------------------------------- |
| `TwentyQuestion`  | `'20-question'` | The rulebook quiz; default for every quiz |
| `FifteenQuestion` | `'15-question'` | Three-team practice-meet quiz (this spec) |

Reserved for later, not added now: a value for the two-team rulebook tie-breaker (§2.b).

## Quiz (scoresheet `types/scoresheet.ts`)

Gains one field:

| Field    | Type         | Rules                                                                       |
| -------- | ------------ | --------------------------------------------------------------------------- |
| `format` | `QuizFormat` | Set when the quiz is created; never changed afterwards. Default 20-question |

Lifecycle: `resetStore(format)` creates a quiz with a format. `loadState` copies it from a loaded
file, auto-save, or the tutorial's snapshot. `clearAnswers`, `clearNames`, meet unlinking, and
loading teams from a meet or schedule keep it. Nothing else writes it.

## QuizRules (scoresheet `scoring/quizRules.ts`, derived, never stored)

| Field                      | 20-question | 15-question | Used by                                       |
| -------------------------- | ----------- | ----------- | --------------------------------------------- |
| `regulationQuestions`      | 20          | 15          | `buildColumns`, overtime, completeness checks |
| `firstAbQuestion`          | 16          | 11          | `buildColumns` (`isAB`)                       |
| `firstErrorPointsQuestion` | 17          | 12          | `buildColumns` (`isErrorPoints`), timeouts    |
| `quizOutCorrect`           | 4           | 3           | `scoreTeam`, `validateCells`                  |
| `overtimeRoundSize`        | 3           | 3           | overtime, column visibility, round styling    |

Derived helpers: `firstOvertimeQuestion = regulationQuestions + 1`;
`lastTimeoutQuestion = firstErrorPointsQuestion - 1`.

Invariants (unit-tested): `firstAbQuestion < firstErrorPointsQuestion <= regulationQuestions`, and
`quizRules(TwentyQuestion)` reproduces today's literals exactly.

## Column keys per format

| Format      | Plain   | With A/B          | Overtime (rounds of 3, with A/B) |
| ----------- | ------- | ----------------- | -------------------------------- |
| 20-question | 1 to 15 | 16/16A/16B to 20B | 21, 21A, 21B, ...                |
| 15-question | 1 to 10 | 11/11A/11B to 15B | 16, 16A, 16B, ...                |

The same key can mean different things in the two formats (`16A` is regulation in one, overtime in
the other), so a file's answers are always interpreted under the format the file records.

## Storage keys (scoresheet)

| Name                                   | Kind               | Meaning                                                                                                                            |
| -------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `qzr-sheet:current`                    | `localStorage` key | Auto-save of the current quiz (existing)                                                                                           |
| `qzr-sheet:newer-autosave:<timestamp>` | `localStorage` key | An auto-save from a newer version, kept aside unchanged (FR-018)                                                                   |
| `qzr-sheet:opened-from-newer-file`     | `localStorage` key | The current quiz came from the try-anyway path (FR-017); kept across reloads, cleared when another quiz replaces it                |
| `qzr-sheet:tutorial-from-newer-file`   | `localStorage` key | The quiz the tutorial set aside carried that warning, so it returns after the tutorial or crash recovery                           |
| `qzr-sheet:tutorial-snapshot`          | `localStorage` key | The tutorial's crash-recovery copy (existing); one from a newer version is set aside, or kept in place, never overwritten (FR-018) |

## QuizFile (`packages/shared/src/quizFile.ts`)

See [contracts/quiz-file.md](./contracts/quiz-file.md) for the versioning contract. Shape change:
`quiz.format` is an optional `QuizFormat`: required when `version` is 3, forbidden below 3.
