# CLAUDE.md

slight preference to writing tests before features.

## 🏗️ Tech Stack

**Tauri 2 + Vue 3 + Vite**

## 📊 Scoresheet Layout

### Layout  

#### Rows
* Question header row
* 3 teams
* up to 5 quizzers per team
* running totals row at bottom for each team

#### Columns
* Quizzer/Team header column
* 15 normal questions
* 5 question with A/B parts (questions 16-20)
* 6 questions for overtime (questions 21-26)
* Running total column at end for each team

#### Cell Types
* `c` = correct answer
* `e` = error
* `f` = foul
* `mb`/`b` = missed/bonus

## 🎯 Scoring Rules Summary

**20 Points:**
- Correct answer
- Toss-up questions
- Full team present (+20 start bonus)
- Bonus before question 17

**10 Point Bonuses:**
- 3rd/4th/5th quizzer correct
- Quizout without error (4 correct with no errors by one quizzer)
- Q17+ bonuses ("B" questions)

**10 Point Deductions:**
- Every 3 team fouls
- 2nd+ overruled challenge
- Incorrect if (does not stack):
    - 2nd+ quizzer error
    - 3rd+ team error (does not count for individual error if 1st quizzer error)
    - after Q17 (even if 1st quizzer error or 1st/2nd team error)

**Quizzer Rules:**
- Out after **4 correct** (quizout) or **3 errors/fouls** (error/foul out)
- No individual pts for bonuses/overtime

**Placement Points:**
- 1st: 10 + (score-100)/10
- 2nd: 5 + (score-60)/10
- 3rd: 1 + (score-30)/10

which is the same as saying:
- 1st: score/10 with min of 10
- 2nd: score/10 - 1 with min of 5
- 3rd: score/10 - 3 with min of 1

## 📋 Other rules

### Toss-up and Bonus Questions

If a quizzer gets a question incorrect, the quizzers on that team cannot jump
on the next question. This is called a "toss-up" question. If a quizzer (on a
different team) gets a toss-up question correct, then all three teams can jump
on the next question. If a quizzer gets a toss-up question incorrect, then that
team cannot jump on the next question either. This leaves only one team and is
called a 'bonus' question ('b'/'mb').

### A/B Questions

From question 17 onwards, error points apply even for the first error, and
bonuses are worth 10 points instead of 20.

Questions 17-20 all must have all three teams jumping. This means that if a
quizzer gets a question wrong (say on question 18), the tossup is the same
number just with an 'A' (18A). Similarly, a bonus question would have a 'B'
(18B). This ensures that all three teams can jump on the next numbered question
(question 19 in this example). Because this starts with question 17, question
16 can also have A/B parts to ensure that 17 can have all three teams jumping
(is not a toss-up or bonus).

* All of questions 16-20 can have A/B parts, but only 17-20 have the new scoring rules.
* If a numbered question is correct, then the A/B questions are not asked.
* If an 'A' question is correct, then the 'B' question is not asked.

### Fouls

* Every 3 fouls by a team is -10 pts to the team.
* 3 fouls by the same quizzer eliminates that quizzer from the quiz. -10 pts to
  the individual and the team score. (if also third team foul does not stack to
  -20 pts to the team).
* The quizzer upon whom a foul is called becomes ineligible to answer that
  numbered question, including the toss-up or bonus question.
