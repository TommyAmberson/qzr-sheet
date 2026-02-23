import { CellValue, type Column } from '../types/scoresheet'
import { scoreTeam } from './scoreTeam'
import { colHasAnyContent } from './helpers'

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

/**
 * Compute how many overtime rounds are needed based on cell content.
 *
 * Rules:
 * - Always at least 1 round when overtime is enabled
 * - If any column in the last round has content, add another round
 * - Trailing empty rounds beyond the first are removed
 *
 * @param cellData - the full cell grid (may have fewer columns than `cols`)
 * @param cols - the current column list (must include OT columns)
 * @returns the number of overtime rounds needed
 */
export function computeOvertimeRounds(
  cellData: CellValue[][][],
  cols: Column[],
): number {
  // Find all overtime normal-question numbers present in the column list
  const otNormals = cols.filter((c) => c.isOvertime && c.type === '')
  if (otNormals.length === 0) return 1

  // Group into rounds of 3
  const totalRounds = Math.ceil(otNormals.length / 3)

  // Find the last round that has any content
  let lastUsedRound = 0
  for (let r = 0; r < totalRounds; r++) {
    const roundStart = r * 3
    const roundEnd = Math.min(roundStart + 3, otNormals.length)
    for (let q = roundStart; q < roundEnd; q++) {
      const qNum = otNormals[q]!.number
      // Check all columns for this question number (normal + A + B)
      for (let ci = 0; ci < cols.length; ci++) {
        if (cols[ci]!.number === qNum && cols[ci]!.isOvertime) {
          if (colHasAnyContent(cellData, ci)) {
            lastUsedRound = r + 1
          }
        }
      }
    }
  }

  // Need at least 1 round, and always one empty round beyond last used
  return Math.max(1, lastUsedRound + 1)
}
