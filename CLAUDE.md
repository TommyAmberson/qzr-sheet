# CLAUDE.md

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
