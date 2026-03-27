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
  /** Errored out (3 errors) */
  erroredOut: boolean
  /** Fouled out (3 fouls) */
  fouledOut: boolean
  /** Quizout bonus earned (4 correct with 0 errors) */
  quizoutBonus: boolean
  /** Column index where this quizzer became out, or -1 if not out */
  outAfterCol: number
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
  /** Column indices where a unique quizzer bonus (+10) was awarded → ordinal (3/4/5) */
  uniqueQuizzerBonusCols: Map<number, number>
  /** Column indices where a quizout bonus (+10) was awarded */
  quizoutBonusCols: Set<number>
  /** Column indices where a foul caused a point deduction (-10) */
  foulDeductCols: Set<number>
  /** Column indices where an error had no point deduction */
  freeErrorCols: Set<number>
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
  const qOutAfterCol = new Array(quizzerCount).fill(-1) as number[]

  // Track which quizzers have gotten at least one correct (for 3rd/4th/5th bonus)
  const quizzerHasCorrect = new Array(quizzerCount).fill(false) as boolean[]

  // Team-level accumulators
  let teamErrors = 0
  let teamFouls = 0
  let uniqueCorrectCount = 0
  const uniqueBonusCols = new Map<number, number>()
  const quizoutBonusCols = new Set<number>()
  const foulDeductCols = new Set<number>()
  const freeErrorCols = new Set<number>()

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
              uniqueBonusCols.set(ci, uniqueCorrectCount)
            }
          }

          // Quizout bonus: awarded on the question where the 4th correct happens
          if (qCorrect[qi] === 4 && qError[qi] === 0) {
            qHasQuizoutBonus[qi] = true
            colPoints += 10
            quizoutBonusCols.add(ci)
          }

          // Track quiz-out column
          if (qCorrect[qi] === 4 && qOutAfterCol[qi] === -1) {
            qOutAfterCol[qi] = ci
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

          // Track error-out column (3 errors = out)
          if (qError[qi] === 3 && qOutAfterCol[qi] === -1) {
            qOutAfterCol[qi] = ci
          }
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
        } else {
          freeErrorCols.add(ci)
        }
      } else if (cell === CellValue.Foul) {
        if (!isOvertime) {
          qFoul[qi]++

          // Track foul-out column (3 fouls = out)
          if (qFoul[qi] === 3 && qOutAfterCol[qi] === -1) {
            qOutAfterCol[qi] = ci
          }
        }
        teamFouls++

        // Deduct -10 for every 3rd team foul OR 3rd individual foul (foul-out),
        // but don't stack if both happen on the same foul
        const isTeamFoulDeduct = teamFouls % 3 === 0
        const isFoulOut = !isOvertime && qFoul[qi] === 3
        if (isTeamFoulDeduct || isFoulOut) {
          colPoints -= 10
          foulDeductCols.add(ci)
        }
      }
    }

    runningScore += colPoints
    rawTotals.push(runningScore)
  }

  // Convert raw totals: null out columns where the total didn't change
  const runningTotals: (number | null)[] = rawTotals.map((val, i) => {
    const prev = i === 0 ? onTimeBonus : rawTotals[i - 1]
    if (val !== prev) return val
    return null
  })

  // Build per-quizzer results
  const quizzers: QuizzerScoring[] = []
  for (let qi = 0; qi < quizzerCount; qi++) {
    const correct = qCorrect[qi]!
    const errors = qError[qi]!
    const fouls = qFoul[qi]!
    const quizzedOut = correct >= 4
    const erroredOut = errors >= 3
    const fouledOut = fouls >= 3
    const quizoutBonus = qHasQuizoutBonus[qi]!

    // Individual points: 20 per correct (non-bonus, non-OT)
    let points = correct * 20
    // Quizout without error bonus
    if (quizoutBonus) points += 10
    // 2nd and 3rd individual error: -10 each
    if (errors >= 2) points -= 10
    if (errors >= 3) points -= 10
    // Foul-out penalty: -10 to individual
    if (fouledOut) points -= 10

    quizzers.push({
      points,
      correctCount: correct,
      errorCount: errors,
      foulCount: fouls,
      quizzedOut,
      erroredOut,
      fouledOut,
      quizoutBonus,
      outAfterCol: qOutAfterCol[qi]!,
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
    uniqueQuizzerBonusCols: uniqueBonusCols,
    quizoutBonusCols,
    foulDeductCols,
    freeErrorCols,
  }
}
