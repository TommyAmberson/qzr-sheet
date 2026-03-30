import { CellValue, buildKeyToIdx, type Column } from '../types/scoresheet'
import { scoreTeam } from './scoreTeam'
import { ColStatus } from './helpers'
import { computeGreyedOut } from './greyedOut'

/** Slice a cell grid down to the given column subset, preserving team/quizzer structure */
function sliceCells(cellData: CellValue[][][], cols: Column[], subset: Column[]): CellValue[][][] {
  const indices = subset.map((c) => cols.indexOf(c))
  return cellData.map((team) => team.map((row) => indices.map((i) => row[i]!)))
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
  const regCols = cols.filter((c) => !c.isOvertime)
  const regCells = sliceCells(cellData, cols, regCols)
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
 * Determine which teams are still actively competing in overtime.
 *
 * Starts from the regulation-eligible teams, then walks completed OT rounds
 * and narrows to only those still tied after each round. Teams that broke
 * out of the tie in a completed round are excluded from subsequent rounds.
 *
 * Returns the same set as getOvertimeEligibleTeams when no OT rounds are
 * complete, or a subset once rounds have resolved some teams out.
 */
export function getActiveOtTeams(
  cellData: CellValue[][][],
  cols: Column[],
  onTimes: boolean[],
  noJumps: boolean[],
): Set<number> {
  const eligible = getOvertimeEligibleTeams(cellData, cols, onTimes)
  if (eligible.size < 2) return eligible

  const otNormals = cols.filter((c) => c.isOvertime && c.type === '')
  const totalRounds = Math.ceil(otNormals.length / 3)
  let competing = [...eligible]

  for (let r = 0; r < totalRounds; r++) {
    const firstQ = 21 + r * 3
    const lastQ = firstQ + 2
    if (!questionsComplete(cellData, cols, noJumps, firstQ, lastQ)) break

    const throughCols = cols.filter((c) => !c.isOvertime || c.number <= lastQ)
    const throughCells = sliceCells(cellData, cols, throughCols)
    const scores = throughCells.map(
      (teamCells, ti) => scoreTeam(teamCells, throughCols, onTimes[ti] ?? true).total,
    )
    const stillTied = new Set<number>()
    for (let i = 0; i < competing.length; i++) {
      for (let j = i + 1; j < competing.length; j++) {
        if (scores[competing[i]!] === scores[competing[j]!]) {
          stillTied.add(competing[i]!)
          stillTied.add(competing[j]!)
        }
      }
    }
    if (stillTied.size < 2) break
    competing = competing.filter((i) => stillTied.has(i))
  }

  return new Set(competing)
}

/**
 * Build a per-column ineligibility map for overtime.
 *
 * For each OT column, records which teams cannot jump. A team becomes
 * ineligible from the first round after they break out of the tie.
 * Teams that were never in the regulation tie are ineligible from round 1.
 *
 * Used by computeGreyedOut so tossedUp seeding is scoped correctly —
 * a team resolved out in round 1 is not retroactively tossed-up on
 * round 1 columns, only on round 2+.
 */
export function computeOtIneligibility(
  cellData: CellValue[][][],
  cols: Column[],
  onTimes: boolean[],
  noJumps: boolean[],
): Map<number, Set<number>> {
  const teamCount = cellData.length
  const eligible = getOvertimeEligibleTeams(cellData, cols, onTimes)
  const ineligible = new Map<number, Set<number>>()

  const otNormals = cols.filter((c) => c.isOvertime && c.type === '')
  const totalRounds = Math.ceil(otNormals.length / 3)
  let competing = [...eligible]

  for (let r = 0; r < totalRounds; r++) {
    const firstQ = 21 + r * 3
    const lastQ = firstQ + 2

    // Teams not competing this round are ineligible on all its columns
    const ineligibleThisRound = new Set<number>()
    for (let ti = 0; ti < teamCount; ti++) {
      if (!competing.includes(ti)) ineligibleThisRound.add(ti)
    }
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci]!
      if (!col.isOvertime) continue
      if (col.number < firstQ || col.number > lastQ) continue
      ineligible.set(ci, new Set(ineligibleThisRound))
    }

    if (!questionsComplete(cellData, cols, noJumps, firstQ, lastQ)) break

    const throughCols = cols.filter((c) => !c.isOvertime || c.number <= lastQ)
    const throughCells = sliceCells(cellData, cols, throughCols)
    const scores = throughCells.map(
      (teamCells, ti) => scoreTeam(teamCells, throughCols, onTimes[ti] ?? true).total,
    )
    const stillTied = new Set<number>()
    for (let i = 0; i < competing.length; i++) {
      for (let j = i + 1; j < competing.length; j++) {
        if (scores[competing[i]!] === scores[competing[j]!]) {
          stillTied.add(competing[i]!)
          stillTied.add(competing[j]!)
        }
      }
    }
    if (stillTied.size < 2) break
    competing = competing.filter((i) => stillTied.has(i))
  }

  return ineligible
}

/**
 * Whether a question group (Normal + optional A/B) is complete.
 *
 * A group is complete when the chain has reached a terminal state:
 * answered (Errored/Resolved), Skipped, or no-jumped at every level.
 */
function questionGroupComplete(
  colStatuses: ColStatus[],
  cols: Column[],
  noJumps: boolean[],
  keyToIdx: Map<string, number>,
  ci: number,
): boolean {
  const col = cols[ci]!
  if (noJumps[ci]) return true
  const s = colStatuses[ci]!
  if (s === ColStatus.Pending) return false
  if (!col.isAB || s === ColStatus.Resolved) return true

  // Normal was Errored — check A
  const aIdx = keyToIdx.get(`${col.number}A`)
  if (aIdx === undefined) return false
  const aS = colStatuses[aIdx]!
  if (noJumps[aIdx] || aS === ColStatus.Resolved || aS === ColStatus.Skipped) return true
  if (aS === ColStatus.Pending) {
    // A has no answer — may have been bypassed; fall through to check B
    const bIdx = keyToIdx.get(`${col.number}B`)
    if (bIdx === undefined) return false
    return noJumps[bIdx] || colStatuses[bIdx] !== ColStatus.Pending
  }
  // A was Errored — check B
  const bIdx = keyToIdx.get(`${col.number}B`)
  if (bIdx === undefined) return false
  return noJumps[bIdx] || colStatuses[bIdx] !== ColStatus.Pending
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
  const { colStatuses } = computeGreyedOut(cellData, cols)
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]!
    if (col.type !== '') continue
    if (col.number < fromQ || col.number > toQ) continue
    if (!questionGroupComplete(colStatuses, cols, noJumps, keyToIdx, ci)) return false
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
  const { colStatuses } = computeGreyedOut(cellData, cols)
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]!
    if (col.isOvertime && col.number > maxOtQ) continue
    if (col.type !== '') continue
    if (!questionGroupComplete(colStatuses, cols, noJumps, keyToIdx, ci)) return false
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
    const throughCells = sliceCells(cellData, cols, throughCols)
    const scores = throughCells.map(
      (teamCells, ti) => scoreTeam(teamCells, throughCols, onTimes[ti] ?? true).total,
    )
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
    const throughCells = sliceCells(cellData, cols, throughCols)
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
  const regCells = sliceCells(cellData, cols, regCols)
  return regCells.map((teamCells, ti) => scoreTeam(teamCells, regCols, onTimes[ti] ?? true).total)
}
