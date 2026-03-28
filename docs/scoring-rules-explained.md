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

Placement points are awarded once the quiz is complete, always based on the regulation score (end of
Q20) even when overtime was played — per rules §1.e.4.

Two formula variants are available via the **Legacy pts** toggle.

### Spreadsheet formula (legacy)

Used in official quizmeets for many years. Uses a lookup table with a **base** (minimum) and **bonus
threshold** per place key:

```
points = base + max(floor((score − threshold) / 10), 0)
```

| PlaceKey | Base | Threshold | At 120 | At 110 | At 60 | At 20 | Description              |
| -------- | ---- | --------- | ------ | ------ | ----- | ----- | ------------------------ |
| `1`      | 10   | 80        | 14     | 13     | 10    | 10    | One team in 1st outright |
| `1.2`    | 7    | 60        | 13     | 12     | 7     | 7     | Two teams tied for 1st   |
| `1.3`    | 5    | 50        | 12     | 11     | 6     | 5     | Three teams tied for 1st |
| `2`      | 5    | 50        | 12     | 11     | 6     | 5     | One team in 2nd outright |
| `2.2`    | 3    | 30        | 12     | 11     | 5     | 3     | Two teams tied for 2nd   |
| `3`      | 1    | 20        | 11     | 10     | 5     | 1     | One team in 3rd outright |

The gap between 1st and 2nd (2 pts at score=120) is larger than the gap between 2nd and 3rd (1 pt).
At lower scores the base values dominate and the gaps shrink — at score=60, `1.3`/`2`/`2.2` all give
the same result.

### Rules formula (official rulebook)

The rulebook specifies only solo placements and does not address ties:

| Place | Formula          | Minimum |
| ----- | ---------------- | ------- |
| 1st   | `score / 10`     | 10 pts  |
| 2nd   | `score / 10 − 1` | 5 pts   |
| 3rd   | `score / 10 − 2` | 1 pt    |

The spacing is **equal** — each place is exactly 1 pt apart at any score. Because ties are not
addressed, this app extends the formula using the same equal-spacing principle, stepping the minimum
down as the tie involves more teams or lower places:

| PlaceKey | Formula                 | Minimum | At 120 | At 110 | At 60 | At 20 | Description              |
| -------- | ----------------------- | ------- | ------ | ------ | ----- | ----- | ------------------------ |
| `1`      | `max(10, score/10)`     | 10      | 12     | 11     | 10    | 10    | One team in 1st outright |
| `1.2`    | `max(7,  score/10)`     | 7       | 12     | 11     | 7     | 7     | Two teams tied for 1st   |
| `1.3`    | `max(5,  score/10)`     | 5       | 12     | 11     | 5     | 5     | Three teams tied for 1st |
| `2`      | `max(5,  score/10 − 1)` | 5       | 11     | 10     | 5     | 5     | One team in 2nd outright |
| `2.2`    | `max(3,  score/10 − 1)` | 3       | 11     | 10     | 3     | 3     | Two teams tied for 2nd   |
| `3`      | `max(1,  score/10 − 2)` | 1       | 10     | 9      | 4     | 1     | One team in 3rd outright |

### Comparison across a prelim

In a round robin prelim each team quizzes three times. Assuming score=200 in every quiz (rules:
1st=20, 2nd=19, 3rd=18 — spreadsheet: 1st=22, 2nd=20, 3rd=19):

| Finishes    | Rules | Spreadsheet |
| ----------- | ----- | ----------- |
| 1st/1st/1st | 60    | 66          |
| 1st/1st/2nd | 59    | 64          |
| 1st/1st/3rd | 58    | 63          |
| 1st/2nd/2nd | 58    | 62          |
| 1st/2nd/3rd | 57    | 61          |
| 2nd/2nd/2nd | 57    | 60          |
| 1st/3rd/3rd | 56    | 60          |
| 2nd/2nd/3rd | 56    | 59          |
| 2nd/3rd/3rd | 55    | 58          |
| 3rd/3rd/3rd | 54    | 57          |

`1st/2nd/3rd` and `2nd/2nd/2nd` tie under the rules formula (both 57) because equal spacing means
the same average place gives the same total. Under the spreadsheet they split 61 vs 60.

The gap between always-1st and always-2nd is **3 pts** under rules, **6 pts** under spreadsheet —
wins count for more.

Score level also matters. At score=60 (a weak team quizzing with stronger opposition) both formulas
hit the same floor. The gap widens as scores rise:

| Score | Place | Rules | Spreadsheet | Difference |
| ----- | ----- | ----- | ----------- | ---------- |
| 200   | 1st   | 20    | 22          | +2         |
| 200   | 2nd   | 19    | 20          | +1         |
| 200   | 3rd   | 18    | 19          | +1         |
| 160   | 1st   | 16    | 18          | +2         |
| 160   | 2nd   | 15    | 16          | +1         |
| 160   | 3rd   | 14    | 15          | +1         |
| 60    | 1st   | 10    | 10          | 0          |
| 60    | 2nd   | 5     | 6           | +1         |
| 60    | 3rd   | 4     | 5           | +1         |

Over a 3-quiz prelim, a team winning every quiz at score=200 accumulates 6 more points under the
spreadsheet than under the rules formula. A team winning at score=60 gets the same under both.

In short: the spreadsheet formula rewards **1st place with a higher bonus** — at 200+ pts a 1st
place finish gives 2 extra placement points over the rules formula, and that compounds across every
round. The rules formula gives equal 1-pt steps between places at any score. For weaker teams
scoring 20–80 pts both formulas hit the same floor (10/5/1), so there is no difference at the
bottom. The gap shows up most in the mid-to-top range where scores spread out.
