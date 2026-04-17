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
 * @param teamCells - cells[seatIdx][colIdx]
 * @param columns - all column definitions
 * @param onTime - whether the team was on time
 */
export function scoreTeam(
  teamCells: CellValue[][],
  columns: Column[],
  onTime: boolean,
): TeamScoring {
  const seatCount = teamCells.length

  // --- Per-seat accumulators (only non-bonus, non-OT questions) ---
  const qCorrect = new Array(seatCount).fill(0) as number[]
  const qError = new Array(seatCount).fill(0) as number[]
  const qFoul = new Array(seatCount).fill(0) as number[]
  const qHasQuizoutBonus = new Array(seatCount).fill(false) as boolean[]
  const qOutAfterCol = new Array(seatCount).fill(-1) as number[]

  // Track which seats have gotten at least one correct (for 3rd/4th/5th bonus)
  const seatHasCorrect = new Array(seatCount).fill(false) as boolean[]

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
  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const col = columns[colIdx]!
    let colPoints = 0

    for (let seatIdx = 0; seatIdx < seatCount; seatIdx++) {
      const cell = teamCells[seatIdx]?.[colIdx] ?? CellValue.Empty
      if (cell === CellValue.Empty) continue

      const isBonus = cell === CellValue.Bonus
      const isMissedBonus = cell === CellValue.MissedBonus
      const isOvertime = col.isOvertime

      if (cell === CellValue.Correct) {
        // +20 for correct (non-bonus, non-OT gets individual credit)
        colPoints += 20

        if (!isOvertime) {
          qCorrect[seatIdx]!++

          // 3rd/4th/5th unique quizzer bonus
          if (!seatHasCorrect[seatIdx]) {
            seatHasCorrect[seatIdx] = true
            uniqueCorrectCount++
            if (uniqueCorrectCount >= 3) {
              colPoints += 10
              uniqueBonusCols.set(colIdx, uniqueCorrectCount)
            }
          }

          // Quizout bonus: awarded on the question where the 4th correct happens
          if (qCorrect[seatIdx] === 4 && qError[seatIdx] === 0) {
            qHasQuizoutBonus[seatIdx] = true
            colPoints += 10
            quizoutBonusCols.add(colIdx)
          }

          // Track quiz-out column
          if (qCorrect[seatIdx] === 4 && qOutAfterCol[seatIdx] === -1) {
            qOutAfterCol[seatIdx] = colIdx
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
          qError[seatIdx]!++

          // Track error-out column (3 errors = out)
          if (qError[seatIdx]! === 3 && qOutAfterCol[seatIdx] === -1) {
            qOutAfterCol[seatIdx] = colIdx
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
        } else if (qError[seatIdx]! >= 2) {
          // 2nd+ individual error
          deduct = true
        } else if (teamErrors >= 3 && qError[seatIdx] === 1) {
          // 3rd+ team error, but this is the quizzer's 1st error
          // Still deduct team points, but doesn't count as individual error deduction
          deduct = true
        }
        if (deduct) {
          colPoints -= 10
        } else {
          freeErrorCols.add(colIdx)
        }
      } else if (cell === CellValue.Foul) {
        if (!isOvertime) {
          qFoul[seatIdx]!++

          // Track foul-out column (3 fouls = out)
          if (qFoul[seatIdx] === 3 && qOutAfterCol[seatIdx] === -1) {
            qOutAfterCol[seatIdx] = colIdx
          }
        }
        teamFouls++

        // Deduct -10 for every 3rd team foul OR 3rd individual foul (foul-out),
        // but don't stack if both happen on the same foul
        const isTeamFoulDeduct = teamFouls % 3 === 0
        const isFoulOut = !isOvertime && qFoul[seatIdx] === 3
        if (isTeamFoulDeduct || isFoulOut) {
          colPoints -= 10
          foulDeductCols.add(colIdx)
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

  // Build per-seat results
  const quizzers: QuizzerScoring[] = []
  for (let seatIdx = 0; seatIdx < seatCount; seatIdx++) {
    const correct = qCorrect[seatIdx]!
    const errors = qError[seatIdx]!
    const fouls = qFoul[seatIdx]!
    const quizzedOut = correct >= 4
    const erroredOut = errors >= 3
    const fouledOut = fouls >= 3
    const quizoutBonus = qHasQuizoutBonus[seatIdx]!

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
      outAfterCol: qOutAfterCol[seatIdx]!,
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
