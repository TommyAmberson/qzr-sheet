import { CellValue, buildKeyToIdx, type Column } from '../types/scoresheet'
import { scoreTeam } from './scoreTeam'
import { isResolved, anyTeamHasAnswer } from './helpers'

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
 * Whether a question group (Normal + optional A/B) is complete.
 *
 * A group is complete when the chain has gone as far as it needs to and the
 * last reached column was jumped on (any non-foul answer) or no-jumped.
 * For non-isAB questions (Q1–15) there are no sub-columns so only the Normal
 * is checked. For isAB questions (Q16–20, OT) the chain cascades: an error on
 * Normal reaches A, an error on A reaches B.
 */
function questionGroupComplete(
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
  keyToIdx: Map<string, number>,
  ci: number,
): boolean {
  const col = cols[ci]!
  if (noJumps[ci]) return true
  if (!anyTeamHasAnswer(cellData, ci)) return false
  if (!col.isAB) return true
  if (!isResolved(cellData, ci)) {
    const aIdx = keyToIdx.get(`${col.number}A`)
    if (aIdx === undefined) return false
    if (noJumps[aIdx]) return true
    if (!anyTeamHasAnswer(cellData, aIdx)) {
      // A has no answer — it may have been bypassed (bonus-routing skipped
      // straight to B). Fall through to check B directly.
      const bIdx = keyToIdx.get(`${col.number}B`)
      if (bIdx === undefined) return false
      if (noJumps[bIdx]) return true
      return anyTeamHasAnswer(cellData, bIdx)
    }
    if (!isResolved(cellData, aIdx)) {
      const bIdx = keyToIdx.get(`${col.number}B`)
      if (bIdx === undefined) return false
      if (noJumps[bIdx]) return true
      if (!anyTeamHasAnswer(cellData, bIdx)) return false
    }
  }
  return true
}

/**
 * Check whether a range of questions is completely filled out.
 * Uses question-group cascade logic: each group is done when the chain
 * reached a jumped-on or no-jumped column.
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
    if (col.type !== '') continue
    if (col.number < fromQ || col.number > toQ) continue
    if (!questionGroupComplete(cellData, cols, noJumps, keyToIdx, ci)) return false
  }
  return true
}

/**
 * Whether every question in the visible range has been jumped on or no-jumped.
 * Used for the "Complete" status indicator.
 *
 * Identical cascade logic to questionsComplete but bounded by visible OT rounds
 * rather than a question number range.
 *
 * @param visibleOtRounds - how many OT rounds are currently shown (0 = reg only)
 */
export function quizJumpedComplete(
  cellData: CellValue[][][],
  cols: Column[],
  noJumps: boolean[],
  visibleOtRounds: number,
): boolean {
  const maxOtQ = 20 + visibleOtRounds * 3
  const keyToIdx = buildKeyToIdx(cols)
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]!
    if (col.isOvertime && col.number > maxOtQ) continue
    if (col.type !== '') continue
    if (!questionGroupComplete(cellData, cols, noJumps, keyToIdx, ci)) return false
  }
  return true
}

/**
 * Compute how many overtime rounds should be shown.
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
