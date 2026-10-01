# Feature Specification: 15-question quiz format

**Feature Branch**: `feat/15-question-quiz`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "I want to make a feature in qzr-sheet with 15 question quizzes. Rule
book tie-breaker, but we also use it often for 1-day meets where the stats don't count and we just
need short quizzes for a practice meet. Sometimes 2 teams (when tie breaker), but usually 3. If
needed, we can implement 3 teams first, if that is simpler and easier."

## Context

The scoresheet scores one quiz format today: three teams, 20 regulation questions, A/B sub-questions
on 16 to 20, error points from 17, quiz-out at 4 correct, and overtime from question 21.

Meets also run shorter, 15-question quizzes in two situations:

* **Practice meets**: one-day meets where stats don't count and quizzes are kept short. These are
  usually three teams.
* **Two-team tie-breakers**: rulebook "Types of Quizzes" §2.b defines a two-team 15-question
  tie-breaker quiz.

The rulebook does not define a three-team 15-question quiz. The format this spec adopts for it is
the 20-question structure with its final stretch moved five questions earlier, and the two-team
tie-breaker's quiz-out of 3 correct:

| Rule                                 | 20-question quiz | 15-question quiz |
| ------------------------------------ | ---------------- | ---------------- |
| Regulation questions                 | 1 to 20          | 1 to 15          |
| Questions with A/B sub-questions     | 16 to 20         | 11 to 15         |
| Error points (and 10-point bonuses)  | from 17          | from 12          |
| Timeouts allowed until error points  | before 17        | before 12        |
| Quiz-out, and the quiz-out bonus     | 4 correct        | 3 correct        |
| First overtime question              | 21               | 16               |
| Error-out, foul-out                  | 3, 3             | 3, 3             |
| 3rd, 4th, 5th unique quizzer bonuses | yes              | yes              |
| On-time bonus                        | yes              | yes              |
| Timeouts per team                    | 2                | 2                |

This spec delivers the **three-team** 15-question quiz. The two-team rulebook tie-breaker (§2.b),
which also needs a two-team scoresheet, is a later feature.

## Clarifications

### Session 2026-10-01

* Q: In a 15-question quiz, when is the last point a team may call a timeout? → A: No timeouts after
  error points are announced, so the cutoff follows the start of error points (before question 12 in
  a 15-question quiz, before 17 in a 20-question quiz).
* Q: How many timeouts does each team get in a 15-question quiz? → A: 2 per team, as in a
  20-question quiz. Rules like this one, which the rulebook does not state for this format, get
  their own section in the scoring rules reference.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Score a three-team 15-question quiz (Priority: P1)

An official at a practice meet starts a new 15-question quiz, enters the three teams, and scores it
question by question. The sheet shows 15 questions, offers A and B sub-questions on 11 to 15, and
computes scores, quiz-outs, error-outs, foul-outs, and the running totals under the 15-question
rules.

**Why this priority**: this is the feature. Practice meets are the common case, and today officials
either score them on paper or misuse a 20-question sheet whose rules are wrong for a short quiz.

**Independent Test**: start a 15-question quiz, enter a fixed sequence of answers covering a
quiz-out, a bonus before and after question 12, and an error on question 12 or later, and compare
every team and quizzer total against a hand-scored sheet.

**Acceptance Scenarios**:

1. **Given** the scoresheet is open, **When** the official chooses "New 15-question quiz", **Then**
   the sheet shows questions 1 to 10 as single questions, questions 11 to 15 each with A and B
   sub-questions, no questions 16 to 20, and an indicator that this is a 15-question quiz.
2. **Given** a 15-question quiz, **When** a quizzer answers a third question correctly with no
   errors, **Then** that quizzer is quizzed out (can still answer bonuses, not toss-ups) and the
   team receives the quiz-out bonus.
3. **Given** a 15-question quiz, **When** a bonus is answered correctly on question 11 or earlier,
   **Then** it is worth 20 points; **When** on question 12 or later, **Then** it is worth 10 points.
4. **Given** a 15-question quiz, **When** a quizzer makes their first error on question 12 or later,
   **Then** the team loses 10 points, even if it is the team's first error.
5. **Given** a 15-question quiz, **When** a quizzer makes their first error on question 11 or
   earlier and it is the team's first or second error, **Then** no points are deducted.
6. **Given** a 15-question quiz, **When** the official places a timeout after question 11 (or after
   11A or 11B), **Then** the sheet accepts it; **When** after question 12 or later, **Then** the
   sheet refuses it, the same way it refuses a timeout after question 17 or later in a 20-question
   quiz.
7. **Given** a completed 15-question quiz with no tie, **Then** placements and placement points are
   computed from the scores after question 15, using the quiz's placement formula.

---

### User Story 2 - Break a tie in overtime (Priority: P2)

A 15-question quiz ends with two or three teams tied. With overtime switched on, the sheet adds
overtime rounds the same way it does for a 20-question quiz, numbered from 16.

**Why this priority**: practice meets sometimes play ties off and sometimes let them stand. The
existing overtime switch already covers both, and only the numbering and the point at which
regulation ends change.

**Independent Test**: score a 15-question quiz to a tie, switch overtime on, and confirm that
questions 16 to 18 appear for the tied teams only, with overtime scoring, and that a further round
(19 to 21) appears only if the tie persists.

**Acceptance Scenarios**:

1. **Given** a 15-question quiz with all 15 questions complete and two or more teams tied, **When**
   overtime is on, **Then** an overtime round of questions 16, 17, and 18 appears, open only to the
   tied teams.
2. **Given** a tied 15-question quiz, **When** overtime is off, **Then** no overtime questions
   appear and the tie stands in the placements.
3. **Given** a 15-question quiz with any of questions 1 to 15 incomplete, **Then** no overtime round
   appears, whether or not the scores are tied.

---

### User Story 3 - Keep a 15-question quiz across save, load, and resets (Priority: P2)

An official saves a 15-question quiz to a file, or the sheet auto-saves it, and later reopens it.
Clearing answers or loading teams from a meet or schedule keeps the quiz a 15-question quiz.

**Why this priority**: a quiz that silently reverts to 20 questions on reload would rescore it under
the wrong rules, which the constitution forbids (a load must never silently discard or change
scores).

**Independent Test**: score part of a 15-question quiz, save it, reload the app, open the file, and
confirm the format, answers, and totals are unchanged; then clear answers and load teams, and
confirm the format is still 15 questions.

**Acceptance Scenarios**:

1. **Given** a 15-question quiz in progress, **When** the app is reloaded, **Then** the restored
   quiz is a 15-question quiz with the same answers and totals.
2. **Given** a saved 15-question quiz file, **When** it is opened, **Then** it opens as a
   15-question quiz.
3. **Given** a quiz file saved before this feature existed, **When** it is opened, **Then** it opens
   as a 20-question quiz with its scores unchanged.
4. **Given** a 15-question quiz, **When** the official clears answers, clears names, or loads teams
   from a meet or schedule, **Then** it stays a 15-question quiz.
5. **Given** any quiz, **When** the official chooses "New 20-question quiz", **Then** a 20-question
   quiz starts, exactly as "New quiz" does today.

---

### User Story 4 - Spreadsheet export is unavailable for 15-question quizzes (Priority: P3)

The spreadsheet (ODS) export fills a fixed 20-question template. For a 15-question quiz the export
is unavailable and says why, rather than producing a sheet whose formulas score it wrong.

**Why this priority**: practice-meet stats don't count, so a spreadsheet copy matters less; the
priority is that the app never produces a wrong one.

**Independent Test**: open a 15-question quiz and confirm the export action is disabled and explains
that spreadsheet export supports 20-question quizzes only; open a 20-question quiz and confirm
export works as before.

**Acceptance Scenarios**:

1. **Given** a 15-question quiz, **When** the official opens the save menu, **Then** the spreadsheet
   export is disabled with an explanation; saving and loading the quiz file still work.
2. **Given** a spreadsheet file, **When** it is imported, **Then** it opens as a 20-question quiz,
   as it does today.

---

### Edge Cases

* A quiz file that names a quiz format this version does not recognise fails to load with a message
  that names the unknown format, rather than loading as some other format.
* Column names mean different things in the two formats: in a 15-question quiz, 16, 16A, and 16B are
  the first overtime round, not regulation questions. Loading a file MUST interpret its answers
  under the format the file records, never the other one. Answers in columns that exist in neither
  regulation nor overtime of that format are handled as unknown columns are today.
* Changing format on a quiz in progress is not possible: the format is chosen only when starting a
  new quiz, so no answers are ever re-interpreted under different rules.
* The interactive tutorial always runs on a 20-question quiz. Started from a 15-question quiz, it
  sets that quiz aside and, when it ends, restores it as a 15-question quiz with its answers intact.
* Overtime correct answers in a 15-question quiz do not count toward quiz-out, exactly as in a
  20-question quiz.

## Requirements _(mandatory)_

### Functional Requirements

* **FR-001**: The official MUST be able to start a new quiz as either a 20-question or a 15-question
  quiz. There MUST be no way to change the format of a quiz once it has started.
* **FR-002**: A 15-question quiz MUST present questions 1 to 10 without sub-questions and questions
  11 to 15 with A and B sub-questions, and MUST NOT present questions 16 to 20 as regulation
  questions.
* **FR-003**: A 15-question quiz MUST apply error points, the 10-point bonus value, and the
  all-teams-eligible rule from question 12 onward, and the 20-point bonus value and free first
  errors on question 11 and earlier.
* **FR-004**: A 15-question quiz MUST quiz a quizzer out at 3 correct answers and award the quiz-out
  bonus for 3 correct answers with no errors.
* **FR-005**: Error-out, foul-out, team foul and team error deductions, the unique-quizzer bonuses,
  and the on-time bonus MUST behave identically in both formats.
* **FR-006**: No timeout may be called once error points have begun. In a 15-question quiz the sheet
  MUST accept a timeout after question 11, 11A, or 11B and MUST refuse one after question 12 or
  later, as a 20-question quiz accepts one after 16, 16A, or 16B and refuses one after 17 or later.
* **FR-007**: When overtime is on, a 15-question quiz MUST offer overtime once questions 1 to 15 are
  complete and two or more teams are tied, in rounds of three numbered from 16, with the same
  overtime rules as a 20-question quiz.
* **FR-008**: Placements and placement points for a 15-question quiz MUST be computed from the
  scores after question 15 using the quiz's selected placement formula, unchanged.
* **FR-009**: The quiz format MUST be recorded with the quiz, in auto-save and in the quiz file, and
  restored on load, and answers MUST be interpreted under the recorded format. A 15-question quiz
  records its format explicitly; a 20-question quiz is recorded by the absence of one, so a version
  1 or 2 file MUST load as a 20-question quiz (and one that names a format MUST fail).
* **FR-010**: Clearing answers, clearing names, unlinking a meet, and loading teams from a meet or
  schedule MUST preserve the quiz format.
* **FR-011**: The sheet MUST show at all times which format the current quiz uses.
* **FR-012**: Spreadsheet export MUST be disabled for 15-question quizzes, with an explanation.
  Spreadsheet import MUST continue to produce a 20-question quiz.
* **FR-013**: Every scoring result for a 20-question quiz (totals, outs, bonuses, deductions,
  grey-outs, validation, overtime, placement) MUST be unchanged by this feature.
* **FR-014**: Because the rulebook does not define a three-team 15-question quiz, the scoring rules
  reference MUST gain a dedicated section of rules not grounded in the rulebook. It MUST list every
  15-question rule in the Context table, and for each one say what it is based on: the 20-question
  rule it shifts, the two-team tie-breaker (§2.b) rule it borrows, or the maintainer's practice-meet
  convention. This satisfies the constitution's requirement that every departure from the rulebook
  be opt-in and documented.
* **FR-015**: Each team MUST be allowed 2 timeouts in a 15-question quiz, as in a 20-question quiz.

### Key Entities

* **Quiz format**: a property of a quiz, chosen when it starts: 20-question (the default and the
  only format before this feature) or 15-question. It determines the number of regulation questions,
  where A/B sub-questions and error points begin, the quiz-out threshold, the timeout cutoff, and
  where overtime numbering starts. Designed so the two-team tie-breaker can later be added as a
  third format.
* **Quiz file**: the saved quiz. Gains the quiz format; older files without it are 20-question
  quizzes.

## Success Criteria _(mandatory)_

### Measurable Outcomes

* **SC-001**: An official can start and fully score a three-team 15-question practice quiz on the
  scoresheet without paper and without manual corrections.
* **SC-002**: For a set of reference 15-question quizzes scored by hand under the rules in the
  Context table, the sheet's team totals, quizzer totals, outs, and placements match the hand scores
  in 100% of cases.
* **SC-003**: Every existing 20-question scoring test, and every quiz file saved before this
  feature, produces the same results after it.
* **SC-004**: A 15-question quiz survives reload, file save and open, clear answers, and load teams
  with its format, answers, and totals intact in 100% of cases.
* **SC-005**: Starting a 15-question quiz takes the same number of actions as starting a 20-question
  quiz does today.

## Assumptions

* Three-team 15-question rules are the user's stated practice-meet format: the 20-question structure
  shifted five questions earlier, with quiz-out (and its bonus) at 3 correct.
* Placement points apply the existing formulas unchanged to the end-of-regulation score, even though
  practice-meet stats don't count; a 15-question quiz simply scores lower.
* The quiz format is chosen per quiz on the scoresheet. Meets and schedules do not yet record a
  format; a per-meet or per-schedule default is out of scope.
* The two-team scoresheet and the rulebook's two-team 15-question tie-breaker (§2.b) are out of
  scope and follow as a separate feature.
* A 15-question spreadsheet template is out of scope.
* Results submission and stats, which do not exist yet, will need to read the quiz format when they
  arrive; nothing on the server stores or validates the format today.
