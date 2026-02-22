import { CellValue, type Column } from '../types/scoresheet'

export interface QuizzerScoring {
  /** Points scored by this quizzer (no bonus/OT individual points) */
  points: number
  /** Number of correct answers (non-bonus, non-OT) */
  correctCount: number
  /** Number of errors */
  errorCount: number
  /** Number of fouls */
  foulCount: number
  /** Quizzed out (4 correct) */
  quizzedOut: boolean
  /** Errored/fouled out (3 errors+fouls) */
  erroredOut: boolean
  /** Fouled out specifically (3+ fouls, 0 errors) */
  fouledOut: boolean
  /** Quizout bonus earned (4 correct with 0 errors) */
  quizoutBonus: boolean
}

export interface TeamScoring {
  /** Total team score */
  total: number
  /** Running total at each column index (null if unchanged from previous) */
  runningTotals: (number | null)[]
  /** Per-quizzer scoring breakdown */
  quizzers: QuizzerScoring[]
  /** On-time bonus applied */
  onTimeBonus: number
  /** Number of unique quizzers who answered correctly */
  uniqueCorrectQuizzers: number
  /** Team error count */
  teamErrorCount: number
  /** Team foul count */
  teamFoulCount: number
}

/**
 * Calculate full scoring for one team.
 *
 * @param teamCells - cells[quizzerIdx][colIdx]
 * @param columns - all column definitions
 * @param onTime - whether the team was on time
 */
export function scoreTeam(
  teamCells: CellValue[][],
  columns: Column[],
  onTime: boolean,
): TeamScoring {
  const quizzerCount = teamCells.length

  // --- Per-quizzer accumulators (only non-bonus, non-OT questions) ---
  const qCorrect = new Array(quizzerCount).fill(0) as number[]
  const qError = new Array(quizzerCount).fill(0) as number[]
  const qFoul = new Array(quizzerCount).fill(0) as number[]
  const qHasQuizoutBonus = new Array(quizzerCount).fill(false) as boolean[]

  // Track which quizzers have gotten at least one correct (for 3rd/4th/5th bonus)
  const quizzerHasCorrect = new Array(quizzerCount).fill(false) as boolean[]

  // Team-level accumulators
  let teamErrors = 0
  let teamFouls = 0
  let uniqueCorrectCount = 0

  // Running total built column by column
  let runningScore = 0
  const rawTotals: number[] = []

  // On-time bonus: +20 if all quizzers present (applied at start)
  const onTimeBonus = onTime ? 20 : 0
  runningScore += onTimeBonus

  // Process columns left to right
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]!
    let colPoints = 0

    for (let qi = 0; qi < quizzerCount; qi++) {
      const cell = teamCells[qi]?.[ci] ?? CellValue.Empty
      if (cell === CellValue.Empty) continue

      const isBonus = cell === CellValue.Bonus
      const isMissedBonus = cell === CellValue.MissedBonus
      const isOvertime = col.isOvertime

      if (cell === CellValue.Correct) {
        // +20 for correct (non-bonus, non-OT gets individual credit)
        colPoints += 20

        if (!isOvertime) {
          qCorrect[qi]++

          // 3rd/4th/5th unique quizzer bonus
          if (!quizzerHasCorrect[qi]) {
            quizzerHasCorrect[qi] = true
            uniqueCorrectCount++
            if (uniqueCorrectCount >= 3) {
              colPoints += 10
            }
          }

          // Quizout bonus: awarded on the question where the 4th correct happens
          if (qCorrect[qi] === 4 && qError[qi] === 0) {
            qHasQuizoutBonus[qi] = true
            colPoints += 10
          }
        }
      } else if (isBonus) {
        // Bonus question correct
        if (col.isErrorPoints) {
          // Q17+ / OT: bonus worth 10
          colPoints += 10
        } else {
          // Before Q17: bonus worth 20
          colPoints += 20
        }
      } else if (isMissedBonus) {
        // No points for missed bonus
      } else if (cell === CellValue.Error) {
        if (!isOvertime) {
          qError[qi]++
        }
        teamErrors++

        // Error deduction: -10 if any of these (don't stack):
        //   - isErrorPoints (Q17+/OT): always
        //   - 2nd+ individual error
        //   - 3rd+ team error (but doesn't count as individual if 1st quizzer error)
        let deduct = false
        if (col.isErrorPoints) {
          deduct = true
        } else if (qError[qi] >= 2) {
          // 2nd+ individual error
          deduct = true
        } else if (teamErrors >= 3 && qError[qi] === 1) {
          // 3rd+ team error, but this is the quizzer's 1st error
          // Still deduct team points, but doesn't count as individual error deduction
          deduct = true
        }
        if (deduct) {
          colPoints -= 10
        }
      } else if (cell === CellValue.Foul) {
        if (!isOvertime) {
          qFoul[qi]++
        }
        teamFouls++
        // Every 3rd team foul: -10
        if (teamFouls % 3 === 0) {
          colPoints -= 10
        }
      }
    }

    runningScore += colPoints
    rawTotals.push(runningScore)
  }

  // Convert raw totals: null out columns where the total didn't change
  // Always show the first column so the on-time bonus is visible
  const runningTotals: (number | null)[] = rawTotals.map((val, i) => {
    if (i === 0) return val
    return val !== rawTotals[i - 1] ? val : null
  })

  // Build per-quizzer results
  const quizzers: QuizzerScoring[] = []
  for (let qi = 0; qi < quizzerCount; qi++) {
    const correct = qCorrect[qi]!
    const errors = qError[qi]!
    const fouls = qFoul[qi]!
    const quizzedOut = correct >= 4
    const erroredOut = errors + fouls >= 3
    const fouledOut = erroredOut && errors === 0
    const quizoutBonus = qHasQuizoutBonus[qi]!

    // Individual points: 20 per correct (non-bonus, non-OT)
    let points = correct * 20
    // Quizout without error bonus
    if (quizoutBonus) points += 10

    quizzers.push({
      points,
      correctCount: correct,
      errorCount: errors,
      foulCount: fouls,
      quizzedOut,
      erroredOut,
      fouledOut,
      quizoutBonus,
    })
  }

  return {
    total: runningScore,
    runningTotals,
    quizzers,
    onTimeBonus,
    uniqueCorrectQuizzers: uniqueCorrectCount,
    teamErrorCount: teamErrors,
    teamFoulCount: teamFouls,
  }
}
