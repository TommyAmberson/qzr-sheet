import { CellValue, buildKeyToIdx, type Column } from '../types/scoresheet'
import { scoreTeam } from './scoreTeam'
import { isResolved } from './helpers'

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
  const scores = regCells.map(
    (teamCells, ti) => scoreTeam(teamCells, regCols, onTimes[ti] ?? true).total,
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
 * Check whether a range of questions is completely filled out.
 * A question is "complete" if its normal column is resolved (C/B/MB) or no-jumped.
 * For isAB questions (Q16–20, OT), resolving any sub-column (A or B) also counts.
 */
export function questionsComplete(
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
  fromQ: number,
  toQ: number,
): boolean {
  const keyToIdx = buildKeyToIdx(cols)
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]!
    if (col.type !== '') continue // skip A/B sub-columns
    if (col.number < fromQ || col.number > toQ) continue
    if (noJumps[ci]) continue
    if (isResolved(cellData, ci)) continue
    // For isAB questions, the group is complete when any sub-column is resolved
    if (col.isAB) {
      const aIdx = keyToIdx.get(`${col.number}A`)
      const bIdx = keyToIdx.get(`${col.number}B`)
      if (
        (aIdx !== undefined && isResolved(cellData, aIdx)) ||
        (bIdx !== undefined && isResolved(cellData, bIdx))
      )
        continue
    }
    return false
  }
  return true
}

/**
 * Compute how many overtime rounds should be shown.
 *
 * Returns 0 if regulation is incomplete or no teams are tied.
 * Returns 1 if regulation is complete and tied (show Q21-23).
 * Returns N+1 if OT round N is complete and teams are still tied.
 *
 * @param cellData - the full cell grid
 * @param cols - all column definitions (including OT columns already built)
 * @param onTimes - per-team on-time flags
 * @param noJumps - per-column no-jump flags
 * @returns number of overtime rounds to display
 */
export function computeOvertimeRounds(
  cellData: CellValue[][][],
  cols: Column[],
  onTimes: boolean[],
  noJumps: boolean[],
): number {
  // Regulation must be completely filled out (Q1-20)
  if (!questionsComplete(cellData, cols, noJumps, 1, 20)) return 0

  // At least two teams must be tied on regulation scores
  const eligible = getOvertimeEligibleTeams(cellData, cols, onTimes)
  if (eligible.size < 2) return 0

  // Check each existing OT round: if complete and still tied, need another.
  // Only check ties among the originally-eligible teams — a non-eligible team
  // matching an eligible team's score is not a real tie.
  const eligibleTeams = [...eligible]
  const otNormals = cols.filter((c) => c.isOvertime && c.type === '')
  const totalRounds = Math.ceil(otNormals.length / 3)

  // Track which eligible teams are still competing (haven't been resolved yet)
  let competing = [...eligibleTeams]

  for (let r = 0; r < totalRounds; r++) {
    const firstQ = 21 + r * 3
    const lastQ = firstQ + 2
    if (!questionsComplete(cellData, cols, noJumps, firstQ, lastQ)) return r + 1

    // Round is complete — check if competing teams are still tied
    const throughCols = cols.filter((c) => !c.isOvertime || c.number <= lastQ)
    const throughCells = cellData.map((teamCells) =>
      teamCells.map((row) =>
        throughCols.map((_, i) => {
          const fullIdx = cols.indexOf(throughCols[i]!)
          return row[fullIdx]!
        }),
      ),
    )
    const scores = throughCells.map(
      (teamCells, ti) => scoreTeam(teamCells, throughCols, onTimes[ti] ?? true).total,
    )

    // Find which competing teams are still tied with each other
    const stillTied = new Set<number>()
    for (let i = 0; i < competing.length; i++) {
      for (let j = i + 1; j < competing.length; j++) {
        if (scores[competing[i]!] === scores[competing[j]!]) {
          stillTied.add(competing[i]!)
          stillTied.add(competing[j]!)
        }
      }
    }

    if (stillTied.size < 2) return r + 1

    // Narrow competing to only those still tied
    competing = competing.filter((i) => stillTied.has(i))
  }

  // All existing rounds complete and still tied — need one more
  return totalRounds + 1
}

/**
 * Compute team scores at each completed OT round checkpoint.
 *
 * Returns an array where each entry is the per-team total scores
 * through that OT round. Only includes rounds that are fully complete.
 */
export function computeOtCheckpointScores(
  cellData: CellValue[][][],
  cols: Column[],
  onTimes: boolean[],
  noJumps: boolean[],
): number[][] {
  const checkpoints: number[][] = []
  const otNormals = cols.filter((c) => c.isOvertime && c.type === '')
  const totalRounds = Math.ceil(otNormals.length / 3)

  for (let r = 0; r < totalRounds; r++) {
    const firstQ = 21 + r * 3
    const lastQ = firstQ + 2
    if (!questionsComplete(cellData, cols, noJumps, firstQ, lastQ)) break

    const throughCols = cols.filter((c) => !c.isOvertime || c.number <= lastQ)
    const throughCells = cellData.map((teamCells) =>
      teamCells.map((row) =>
        throughCols.map((_, i) => {
          const fullIdx = cols.indexOf(throughCols[i]!)
          return row[fullIdx]!
        }),
      ),
    )
    checkpoints.push(
      throughCells.map(
        (teamCells, ti) => scoreTeam(teamCells, throughCols, onTimes[ti] ?? true).total,
      ),
    )
  }

  return checkpoints
}

/**
 * Compute regulation-only scores for each team.
 */
export function computeRegulationScores(
  cellData: CellValue[][][],
  cols: Column[],
  onTimes: boolean[],
): number[] {
  const regCols = cols.filter((c) => !c.isOvertime)
  const regCells = cellData.map((teamCells) =>
    teamCells.map((quizzerRow) =>
      regCols.map((_, ri) => {
        const fullIdx = cols.indexOf(regCols[ri]!)
        return quizzerRow[fullIdx]!
      }),
    ),
  )
  return regCells.map((teamCells, ti) => scoreTeam(teamCells, regCols, onTimes[ti] ?? true).total)
}
