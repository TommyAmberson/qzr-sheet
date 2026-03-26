import { PlacementFormula } from '../types/scoresheet'

/**
 * Compute team placements (1st, 2nd, 3rd) progressively.
 * Placements are assigned at each "checkpoint" — after regulation and after
 * each completed OT round. Teams that are no longer tied at a checkpoint
 * receive their placement immediately, even if other teams continue into
 * further OT rounds.
 *
 * OT teams can never pass non-OT teams regardless of final score.
 *
 * @param regulationScores - scores using only regulation columns (Q1–20)
 * @param checkpointScores - scores after each completed OT round
 *   checkpointScores[0] = scores through OT round 1, etc.
 *   Only includes rounds that are fully complete.
 * @param regulationComplete - whether all regulation questions are filled out
 * @param overtimeEnabled - when false, remaining ties after regulation are final and
 *   tied teams share their placement; when true, tied teams stay null until OT resolves them
 * @returns array of placements (1/2/3) per team, or null if not yet placed
 */
export function computePlacements(
  regulationScores: number[],
  checkpointScores: number[][],
  regulationComplete: boolean,
  overtimeEnabled = true,
): (number | null)[] {
  const teamCount = regulationScores.length
  const placements: (number | null)[] = new Array(teamCount).fill(null)

  if (!regulationComplete) return placements

  // Rank all teams by regulation score to determine natural positions
  const sorted = allTeamIndices(teamCount).sort(
    (a, b) => regulationScores[b]! - regulationScores[a]!,
  )

  // Determine which teams are tied after regulation
  const regTied = findTiedTeams(regulationScores)

  // Place non-tied teams at their natural rank position
  // Tied teams' slots are reserved but left as null
  let place = 1
  for (let i = 0; i < sorted.length; i++) {
    // Determine rank: same score as previous → same rank, else rank = position
    if (i > 0 && regulationScores[sorted[i]!]! < regulationScores[sorted[i - 1]!]!) {
      place = i + 1
    }
    if (!regTied.has(sorted[i]!)) {
      placements[sorted[i]!] = place
    }
  }

  // Find the starting placement slot for the tied group
  // (the rank they all share after regulation)
  const tiedTeams = allTeamIndices(teamCount).filter((i) => regTied.has(i))
  if (tiedTeams.length === 0) return placements

  const tiedRank = sorted.indexOf(tiedTeams[0]!) + 1

  // Walk through OT checkpoints, peeling off teams that are no longer tied.
  // Teams that drop out (no longer tied) get the BOTTOM slots of the
  // remaining group — they lost, while still-tied teams compete for better
  // positions in later rounds.
  let remaining = [...tiedTeams]
  // bottomPlace tracks the next placement slot from the bottom of the tied group
  let bottomPlace = tiedRank + tiedTeams.length - 1 // e.g. 3 for a 3-way tie starting at 1
  for (let r = 0; r < checkpointScores.length; r++) {
    const scores = checkpointScores[r]!
    const stillTied = findTiedTeamsInGroup(remaining, scores)

    // Teams no longer tied at this checkpoint get placed at the bottom
    const resolved = remaining.filter((i) => !stillTied.has(i))
    if (resolved.length > 0) {
      // Rank resolved teams among themselves, but starting from the bottom slots
      const resolvedStartPlace = bottomPlace - resolved.length + 1
      rankGroup(resolved, scores, resolvedStartPlace, placements)
      bottomPlace -= resolved.length
    }

    remaining = remaining.filter((i) => stillTied.has(i))
    if (remaining.length <= 1) {
      if (remaining.length === 1) {
        placements[remaining[0]!] = tiedRank
      }
      break
    }
  }

  // If remaining teams are still tied: assign shared placement when OT is disabled
  // (tie is final), leave as null when OT is enabled (more rounds may come).
  if (!overtimeEnabled && remaining.length > 1) {
    for (const i of remaining) {
      placements[i] = tiedRank
    }
  }

  return placements
}

function allTeamIndices(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i)
}

/** Find teams that share a score with at least one other team */
function findTiedTeams(scores: number[]): Set<number> {
  const tied = new Set<number>()
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      if (scores[i] === scores[j]) {
        tied.add(i)
        tied.add(j)
      }
    }
  }
  return tied
}

/** Find teams within a group that are still tied with each other */
function findTiedTeamsInGroup(group: number[], scores: number[]): Set<number> {
  const tied = new Set<number>()
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (scores[group[i]!] === scores[group[j]!]) {
        tied.add(group[i]!)
        tied.add(group[j]!)
      }
    }
  }
  return tied
}

/**
 * Compute placement points for a team given their regulation score and place (1/2/3).
 *
 * Per rules §1.e.4, placement points are always based on the score at end of Q20,
 * even when overtime was played to break the tie. Callers must pass the regulation
 * score, not the total including overtime.
 *
 * | Place | Formula          | Minimum |
 * |-------|------------------|---------|
 * | 1st   | score / 10       | 10 pts  |
 * | 2nd   | score / 10 − 1   | 5 pts   |
 * | 3rd   | score / 10 − 3   | 1 pt    |
 *
 * Returns null if place is null (not yet determined).
 */
export function computePlacementPoints(
  score: number,
  place: number | null,
  formula = PlacementFormula.Rules,
): number | null {
  if (place === null) return null
  const base = Math.floor(score / 10)
  const offset = formula === PlacementFormula.Spreadsheet ? 2 : 0
  if (place === 1) return Math.max(10, base + offset)
  if (place === 2) return Math.max(5, base - 1 + offset)
  if (place === 3) return Math.max(1, base - 2 + offset)
  return null
}

/** Rank a group by score descending, assigning placements starting at startPlace */
function rankGroup(
  group: number[],
  scores: number[],
  startPlace: number,
  placements: (number | null)[],
) {
  const sorted = [...group].sort((a, b) => scores[b]! - scores[a]!)
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      placements[sorted[i]!] = startPlace
    } else if (scores[sorted[i]!]! < scores[sorted[i - 1]!]!) {
      placements[sorted[i]!] = startPlace + i
    } else {
      placements[sorted[i]!] = placements[sorted[i - 1]!]!
    }
  }
}
