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

**Columns:**

* Q1–15: normal questions
* Q16–20: normal + optional A/B sub-columns
* Q21–26: overtime (3 questions per round, up to 2 rounds = 6 questions)
* Running total column per team (rightmost)

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

Placements points are awarded once the quiz is complete. If overtime is involved, then the ties are
broken by OT but the scores used are the scores the teams had at the end of regulation.

Two formula variants are available via the **Legacy pts** toggle:

**Rules (official rulebook):**

| Place | Formula          | Minimum |
| ----- | ---------------- | ------- |
| 1st   | `score / 10`     | 10 pts  |
| 2nd   | `score / 10 − 1` | 5 pts   |
| 3rd   | `score / 10 − 2` | 1 pt    |

**Spreadsheet (legacy, matches historical scoresheets):**

| Place | Formula          | Minimum |
| ----- | ---------------- | ------- |
| 1st   | `score / 10 + 2` | 10 pts  |
| 2nd   | `score / 10`     | 5 pts   |
| 3rd   | `score / 10 − 1` | 1 pt    |
