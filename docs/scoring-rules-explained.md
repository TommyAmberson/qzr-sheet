# Scoring Rules Reference

## Cell Types

| Value | Meaning                                      |
| ----- | -------------------------------------------- |
| `c`   | Correct answer                               |
| `e`   | Error (incorrect answer)                     |
| `f`   | Foul                                         |
| `b`   | Bonus (correct on a bonus question)          |
| `mb`  | Missed bonus (incorrect on a bonus question) |

In code these are the `CellValue` enum in `src/types/scoresheet.ts`.

## Scoresheet Layout

**Rows:** question header, 3 teams × (up to 5 quizzers + running total row)

**Columns** (20-question quiz; see [Quiz Formats](#quiz-formats) for the 15-question layout):

* Q1–15: normal questions
* Q16–20: normal + optional A/B sub-columns
* Q21+: overtime (3 questions per round, rounds added until the tie is broken)
* Running total column per team (rightmost)

## Quiz Formats

Each quiz has a `QuizFormat` (`packages/shared/src/quizFile.ts`), chosen when it starts from the New
menu and fixed for the life of the quiz. The rest of this document describes the default 20-question
quiz; the 15-question quiz moves its final stretch five questions earlier:

| Rule                                | 20-question quiz | 15-question quiz |
| ----------------------------------- | ---------------- | ---------------- |
| Regulation questions                | 1 to 20          | 1 to 15          |
| Questions with A/B sub-columns      | 16 to 20         | 11 to 15         |
| Error points (and 10-point bonuses) | from 17          | from 12          |
| Free first errors, 20-point bonuses | through 16       | through 11       |
| Timeouts allowed until error points | before 17        | before 12        |
| Quiz-out, and the quiz-out bonus    | 4 correct        | 3 correct        |
| First overtime question             | 21               | 16               |

Everything else is the same in both: error-out and foul-out at 3, team foul and error deductions,
the 3rd/4th/5th unique-quizzer bonuses, the on-time bonus, 2 timeouts per team, overtime rounds of
3, and placement points from the end-of-regulation score. The numbers live in one table,
`apps/scoresheet/src/scoring/quizRules.ts`. Column keys depend on the format: `16A` is a regulation
column in a 20-question quiz and the first overtime round in a 15-question one, so a saved file is
always read under the format it records.

The rulebook does not define a three-team 15-question quiz; see
[Rules Not in the Rulebook](#rules-not-in-the-rulebook).

## Point Values

### +20 Points

* Correct answer (any non-bonus, non-overtime question)
* On-time bonus: full team present at start (+20 once per team)
* Bonus question correct _before_ Q17

### +10 Bonuses (team score only, no individual credit)

* 3rd, 4th, 5th unique quizzer to answer correctly in a quiz
* Quizout bonus: 4 correct answers with 0 errors by one quizzer
* Bonus question correct Q17+ (including overtime)

### −10 Deductions

* Every 3rd team foul
* 2nd+ individual quizzer error
* 3rd+ team error (even if it's that quizzer's 1st error)
* Any error on Q17+ / overtime (even 1st individual, 1st team)
* **Deductions do not stack:** if multiple rules apply on the same answer, only −10 total

### Free Errors (no deduction)

A quizzer's first error is free if _all_ of:

* It is their 1st individual error
* It is the team's 1st or 2nd error
* The question is Q16 or earlier (not `isErrorPoints`)

## Quizzer Out Rules

| Condition | Threshold         | Effect                                                                             |
| --------- | ----------------- | ---------------------------------------------------------------------------------- |
| Quizout   | 4 correct answers | Quizzer stays seated; can still answer bonus (B/MB) but not C/E                    |
| Error out | 3 errors          | Quizzer must leave; cannot answer anything (not even fouls)                        |
| Foul out  | 3 fouls           | Quizzer must leave; −10 to individual and team (does not stack with 3rd-team-foul) |

**No individual points** for bonus questions or overtime correct answers.

## Toss-up and Bonus Questions

When a quizzer answers incorrectly, their team **cannot jump** on the next question — this is a
**toss-up**. The toss-up chain carries forward:

* If the toss-up question is also answered incorrectly (by a different team), _that_ team is also
  locked out of the next question.
* When only one team remains eligible, the question is a **bonus** question (`b`/`mb`).
* If a toss-up is answered correctly, all three teams can jump on the next question.

### Who may answer a bonus

Two variants are available via `BonusRule` (`packages/shared/src/quizFile.ts`), stored per quiz in
`QuizFile`:

* **Seat** (default, per "Types of Quizzes" §1.g–h and §3.c in `docs/rules.md`): the bonus goes to
  the corresponding chair on the team that has not erred, so only the quizzer in the seat matching
  the last error may answer. The other seats on the bonus team are greyed out.
* **Team**: any quizzer on the bonus team may answer. Retained as an opt-in variant for meets that
  run it that way; there is no UI toggle, and it is set only through a loaded `QuizFile`.

Files saved before `bonusRule` existed load as **Seat**.

## A/B Questions (Q16–20)

Questions 16–20 have optional A and B sub-columns. These exist to preserve the rule that Q17–20
always have all three teams eligible to jump.

**A is always a toss-up (two teams eligible); B is always a bonus (one team eligible).**

* If the **numbered question** (e.g. Q18) is answered correctly → A and B are not asked.
* If the **numbered question** is answered incorrectly → the **A** sub-question is a toss-up for the
  two remaining teams.
* If the **A question** is answered correctly → B is not asked.
* If the **A question** is also answered incorrectly → the **B** sub-question is a bonus for the
  remaining eligible team.

**Special case — numbered question was already a toss-up:** If the numbered question was itself a
toss-up (one team already locked out from a prior error) and is answered incorrectly, only one team
remains eligible. There is no toss-up to ask, so **A is skipped entirely** and B is asked directly
as a bonus.

**Scoring difference:**

* Q16 A/B: uses standard scoring (bonus = +20, no automatic error deduction)
* Q17–20 A/B: `isErrorPoints = true` (bonus = +10, errors always deduct −10)

## Fouls

* Every 3rd **team** foul: −10 to the team.
* 3rd foul by the **same quizzer**: foul-out, −10 to individual and team. Does **not** stack with
  the 3rd-team-foul deduction if both happen on the same foul.
* The quizzer **upon whom** a foul is called is ineligible to answer that numbered question,
  including its A and B sub-parts.

## Overtime

Overtime is only played when two or more teams are tied after regulation (Q1–20). Only tied teams
are eligible to answer overtime questions.

* Overtime questions use `isErrorPoints = true` (same rules as Q17+).
* Questions are grouped in rounds of 3 (Q21–23, Q24–26, …).
* A new round is shown only when the previous round is complete and teams are still tied.
* Overtime correct answers do **not** count toward individual quizzer stats (no quiz-out, no
  individual points).
* **2-way tie:** when only two teams are eligible, every numbered OT question is effectively a
  toss-up (only two teams can jump). An error leaves one team → A is skipped, B is asked directly as
  a bonus. The same A=toss-up / B=bonus rule from regulation applies.

## Placement Points

Placement points are awarded once the quiz is complete, always based on the regulation score (end of
Q20, or Q15 in a 15-question quiz) even when overtime was played — per rules §1.e.4.

Two formula variants are available via `PlacementFormula` in `src/types/scoresheet.ts`. The
**Rules** formula is the default and is shown in the UI; the **Legacy** formula is retained for
reference but the toggle is hidden.

### Legacy formula (pre-2023)

Used in official quizmeets for many years. Uses a lookup table with a **base** (minimum) and **bonus
threshold** per place key:

```
points = base + max(floor((score − threshold) / 10), 0)
```

| PlaceKey | Base | Threshold | Description              | Alternate Calculation |
| -------- | ---- | --------- | ------------------------ | --------------------- |
| `1`      | 10   | 80        | One team in 1st outright | max(10, score/10 + 2) |
| `1.2`    | 7    | 60        | Two teams tied for 1st   | max(7, score/10 + 1)  |
| `1.3`    | 5    | 50        | Three teams tied for 1st | max(5, score/10)      |
| `2`      | 5    | 50        | One team in 2nd outright | max(5, score/10)      |
| `2.2`    | 3    | 30        | Two teams tied for 2nd   | max(3, score/10)      |
| `3`      | 1    | 20        | One team in 3rd outright | max(1, score/10 - 1)  |

### Rules formula (official rulebook)

The rulebook specifies only solo placements and does not address ties:

| Place | Formula          | Minimum |
| ----- | ---------------- | ------- |
| 1st   | `score / 10`     | 10 pts  |
| 2nd   | `score / 10 − 1` | 5 pts   |
| 3rd   | `score / 10 − 2` | 1 pt    |

The legacy formula predates May 2023. It gives a higher base for outright 1st place and
distinguishes between tied and untied placements differently than the rulebook.

| PlaceKey | Base | Threshold | Description              | Alternate Calculation |
| -------- | ---- | --------- | ------------------------ | --------------------- |
| `1`      | 10   | 100       | One team in 1st outright | max(10, score/10)     |
| `1.2`    | 10   | 100       | Two teams tied for 1st   | max(10, score/10)     |
| `1.3`    | 10   | 100       | Three teams tied for 1st | max(10, score/10)     |
| `2`      | 5    | 60        | One team in 2nd outright | max(5, score/10 - 1)  |
| `2.2`    | 5    | 60        | Two teams tied for 2nd   | max(5, score/10 - 1)  |
| `3`      | 1    | 30        | One team in 3rd outright | max(1, score/10 - 2)  |

## Rules Not in the Rulebook

The official rulebook (`docs/rules.md`) is the specification. These rules are not stated there, so
each is an opt-in departure, listed with what it is based on.

### 15-question quiz

The rulebook's only 15-question quiz is the two-team tie-breaker ("Types of Quizzes" §2.b). Practice
meets also run short three-team quizzes, which the rulebook does not cover. The scoresheet's
15-question format is that three-team quiz; the two-team tie-breaker is not supported yet.

| Rule                                          | Based on                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Three teams                                   | Practice-meet convention                                                                       |
| 15 regulation questions                       | The tie-breaker's length (§2.b)                                                                |
| A/B sub-questions on 11 to 15                 | The 20-question quiz's 16 to 20 (§1.h–i), moved five questions earlier                         |
| Error points and 10-point bonuses from 12     | The 20-question quiz's from 17 (§1.j–k), moved five questions earlier                          |
| Free first errors and 20-point bonuses to 11  | The 20-question quiz's through 16, moved five questions earlier                                |
| No timeouts once error points begin (from 12) | "No timeout can be called after question 17 is introduced" (§8.a), moved                       |
| Quiz-out, and its bonus, at 3 correct         | The tie-breaker's three correct answers (§2.b.vi)                                              |
| Overtime from 16, in rounds of 3              | The 20-question quiz's overtime units of three (§1.d), after question 15                       |
| Error-out and foul-out at 3                   | Unchanged; the same in every rulebook quiz                                                     |
| 2 timeouts per team                           | Unchanged from §8.a; practice-meet convention                                                  |
| Unique-quizzer and on-time bonuses            | Unchanged; practice-meet convention                                                            |
| Placement points from the end-of-Q15 score    | The existing formulas, unchanged (§1.e.4 uses the end of regulation); practice-meet convention |

### Other departures

* The **Legacy** placement formula and the **Team** bonus rule, described above, are opt-in variants
  retained for meets that run them.
