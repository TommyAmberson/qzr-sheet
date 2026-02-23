import { CellValue, MAX_OVERTIME_QUESTIONS, type Column } from '../types/scoresheet'
import { scoreTeam } from './scoreTeam'

/**
 * Determine how many overtime questions (columns) should be visible.
 *
 * @param overtimeRounds - Number of overtime rounds (0 = off, each round = 3 questions)
 * @returns Number of overtime questions to show (0, 3, 6, 9, … up to MAX_OVERTIME_QUESTIONS)
 *
 * A/B sub-columns for each OT question follow the same show/hide logic as
 * regulation A/B columns (handled separately by abColumnNeeded).
 */
export function overtimeQuestionsNeeded(
  overtimeRounds: number,
): number {
  if (overtimeRounds <= 0) return 0
  return Math.min(overtimeRounds * 3, MAX_OVERTIME_QUESTIONS)
}

/**
 * Determine which teams are eligible for overtime based on regulation-only scores.
 *
 * Teams that share any tied score are eligible (not just the highest tie).
 * Teams with unique scores (no other team has the same score) are not eligible.
 *
 * Returns a Set of team indices (0-based).
 */
export function getOvertimeEligibleTeams(
  cellData: CellValue[][][],
  cols: Column[],
  onTimes: boolean[],
): Set<number> {
  // Score each team using only regulation columns
  const regCols = cols.filter((c) => !c.isOvertime)
  const regCells = cellData.map((teamCells) =>
    teamCells.map((quizzerRow) =>
      regCols.map((_, ri) => {
        const fullIdx = cols.indexOf(regCols[ri]!)
        return quizzerRow[fullIdx]!
      }),
    ),
  )
  const scores = regCells.map((teamCells, ti) =>
    scoreTeam(teamCells, regCols, onTimes[ti] ?? true).total,
  )

  // Find teams that share a score with at least one other team
  const eligible = new Set<number>()
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      if (scores[i] === scores[j]) {
        eligible.add(i)
        eligible.add(j)
      }
    }
  }

  return eligible
}
