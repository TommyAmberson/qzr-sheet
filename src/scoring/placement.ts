import { PlacementFormula, type PlaceKey } from '../types/scoresheet'

/**
 * Compute team placements progressively.
 * Placements are assigned at each "checkpoint" — after regulation and after
 * each completed OT round. Teams that are no longer tied at a checkpoint
 * receive their placement immediately, even if other teams continue into
 * further OT rounds.
 *
 * OT teams can never pass non-OT teams regardless of final score.
 *
 * @param regulationScores - scores using only regulation columns (Q1–20)
 * @param checkpointScores - scores after each completed OT round;
 *   only includes rounds that are fully complete
 * @param regulationComplete - whether all regulation questions are filled out
 * @param overtimeEnabled - when false, remaining ties after regulation are final
 *   and tied teams share their placement; when true, tied teams stay null until
 *   OT resolves them
 * @returns PlaceKey per team (encoding rank + tie-width), or null if not yet placed
 */
export function computePlacements(
  regulationScores: number[],
  checkpointScores: number[][],
  regulationComplete: boolean,
  overtimeEnabled = true,
): (PlaceKey | null)[] {
  const teamCount = regulationScores.length
  const placements: (PlaceKey | null)[] = new Array(teamCount).fill(null)

  if (!regulationComplete) return placements

  const sorted = allTeamIndices(teamCount).sort(
    (a, b) => regulationScores[b]! - regulationScores[a]!,
  )

  const regTied = findTiedTeams(regulationScores)

  // Place non-tied teams at their natural rank
  let place = 1
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && regulationScores[sorted[i]!]! < regulationScores[sorted[i - 1]!]!) {
      place = i + 1
    }
    if (!regTied.has(sorted[i]!)) {
      placements[sorted[i]!] = place as PlaceKey
    }
  }

  const tiedTeams = allTeamIndices(teamCount).filter((i) => regTied.has(i))
  if (tiedTeams.length === 0) return placements

  const tiedRank = sorted.indexOf(tiedTeams[0]!) + 1

  // Walk OT checkpoints, peeling off teams that break from the tied group.
  // Teams that drop out get the bottom slots; still-tied teams compete for top.
  let remaining = [...tiedTeams]
  let bottomPlace = tiedRank + tiedTeams.length - 1
  for (let r = 0; r < checkpointScores.length; r++) {
    const scores = checkpointScores[r]!
    const stillTied = findTiedTeamsInGroup(remaining, scores)

    const resolved = remaining.filter((i) => !stillTied.has(i))
    if (resolved.length > 0) {
      const resolvedStartPlace = bottomPlace - resolved.length + 1
      rankGroup(resolved, scores, resolvedStartPlace, placements)
      bottomPlace -= resolved.length
    }

    remaining = remaining.filter((i) => stillTied.has(i))
    if (remaining.length <= 1) {
      if (remaining.length === 1) {
        placements[remaining[0]!] = tiedRank as PlaceKey
      }
      break
    }
  }

  // Ties are final when OT is disabled — assign shared placement
  if (!overtimeEnabled && remaining.length > 1) {
    const key = placeKey(tiedRank, remaining.length)
    for (const i of remaining) {
      placements[i] = key
    }
  }

  return placements
}

/**
 * Derive a PlaceKey from rank + number of teams sharing that rank.
 * e.g. rank=1, count=2 → 1.2; rank=2, count=2 → 2.2
 */
function placeKey(rank: number, tieCount: number): PlaceKey {
  if (tieCount === 1) return rank as PlaceKey
  return parseFloat(`${rank}.${tieCount}`) as PlaceKey
}

function allTeamIndices(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i)
}

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
 * Rank a resolved group within a tied block, assigning PlaceKeys.
 * Teams that are still tied with each other within the resolved group
 * share a PlaceKey encoding the tie-width.
 */
function rankGroup(
  group: number[],
  scores: number[],
  startPlace: number,
  placements: (PlaceKey | null)[],
) {
  const sorted = [...group].sort((a, b) => scores[b]! - scores[a]!)
  for (let i = 0; i < sorted.length; i++) {
    let rank: number
    if (i === 0) {
      rank = startPlace
    } else if (scores[sorted[i]!]! < scores[sorted[i - 1]!]!) {
      rank = startPlace + i
    } else {
      rank = Math.floor(placements[sorted[i - 1]!]! as number)
    }
    const tieCount = sorted.filter((t) => scores[t] === scores[sorted[i]!]).length
    placements[sorted[i]!] = placeKey(rank, tieCount)
  }
}

type PlacementTableEntry = { base: number; threshold: number }

const SPREADSHEET_TABLE: Record<string, PlacementTableEntry> = {
  '1': { base: 10, threshold: 80 },
  '1.2': { base: 7, threshold: 60 },
  '1.3': { base: 5, threshold: 50 },
  '2': { base: 5, threshold: 50 },
  '2.2': { base: 3, threshold: 30 },
  '3': { base: 1, threshold: 20 },
}

const RULES_TABLE: Record<string, PlacementTableEntry> = {
  '1': { base: 10, threshold: 100 },
  '1.2': { base: 7, threshold: 70 },
  '1.3': { base: 5, threshold: 50 },
  '2': { base: 5, threshold: 60 },
  '2.2': { base: 3, threshold: 40 },
  '3': { base: 1, threshold: 30 },
}

/**
 * Compute placement points for a team given their regulation score and PlaceKey.
 *
 * Per rules §1.e.4, placement points are always based on the score at end of Q20,
 * even when overtime was played to break the tie. Callers must pass the regulation
 * score, not the total including overtime.
 *
 * Formula: base + max(floor((score − threshold) / 10), 0)
 * The base also acts as the minimum (when score < threshold, the max() clamps to 0).
 *
 * Returns null if place is null (not yet determined).
 */
export function computePlacementPoints(
  score: number,
  place: PlaceKey | null,
  formula = PlacementFormula.Rules,
): number | null {
  if (place === null) return null
  const table = formula === PlacementFormula.Spreadsheet ? SPREADSHEET_TABLE : RULES_TABLE
  const entry = table[String(place)]
  if (!entry) return null
  return entry.base + Math.max(Math.floor((score - entry.threshold) / 10), 0)
}
