/**
 * Compute team placements (1st, 2nd, 3rd).
 *
 * Rules:
 * - Teams not in overtime are ranked first by score (highest = 1st).
 * - Overtime teams are ranked after all non-OT teams, among themselves by score.
 *   This means OT teams can never pass non-OT teams regardless of final score.
 * - Ties share the same placement.
 *
 * @param totals - final score for each team (indexed by team position)
 * @param otEligible - set of team indices that participated in overtime
 * @param isComplete - whether the quiz is fully filled out
 * @returns array of placements (1/2/3) per team, or null[] if incomplete
 */
export function computePlacements(
  totals: number[],
  otEligible: Set<number>,
  isComplete: boolean,
): (number | null)[] {
  if (!isComplete) return totals.map(() => null)

  const teamCount = totals.length
  const placements: (number | null)[] = new Array(teamCount).fill(null)

  // Split into non-OT and OT groups
  const nonOt: number[] = []
  const ot: number[] = []
  for (let i = 0; i < teamCount; i++) {
    if (otEligible.has(i)) ot.push(i)
    else nonOt.push(i)
  }

  // Rank a group by score descending, assigning placements starting at `startPlace`
  function rankGroup(group: number[], startPlace: number) {
    group.sort((a, b) => totals[b]! - totals[a]!)
    for (let i = 0; i < group.length; i++) {
      if (i === 0) {
        placements[group[i]!] = startPlace
      } else if (totals[group[i]!]! < totals[group[i - 1]!]!) {
        placements[group[i]!] = startPlace + i
      } else {
        placements[group[i]!] = placements[group[i - 1]!]!
      }
    }
  }

  rankGroup(nonOt, 1)
  rankGroup(ot, nonOt.length + 1)

  return placements
}
