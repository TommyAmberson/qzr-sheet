import { resolveBenches, type PlacedTeam, type SettledBench, type TieBreakOrder } from '@qzr/shared'
import { scheduleDivisionId, type MeetFacts } from './quizFacts'

/**
 * The settled benches of a division's scheduled quizzes (spec FR-011, research R3 and R4), from its
 * standing confirmed orders and the teams of its linked quizzes that count (`countingTeams`).
 * Empty with no schedule, or a division the schedule doesn't have.
 */
export function divisionBenches(
  facts: MeetFacts,
  folded: string,
  /** The teams of each stored quiz that counts, by its id */
  counting: Map<number, PlacedTeam[]>,
  /** The scheduled quiz each stored quiz is linked to, by its id */
  links: Map<number, string>,
  /** How the meet breaks ties in its prelim standings, which a round robin is ranked by too */
  tieBreaks: TieBreakOrder,
): Map<string, SettledBench> {
  const doc = facts.schedule?.document
  const division = scheduleDivisionId(facts, folded)
  if (!doc || division === undefined) return new Map()
  // A confirmed order is kept by the meet's division name, a schedule quiz by the schedule's id
  const confirmed = facts.confirmed.get(folded)
  const orders = new Map([
    [division, { prelims: confirmed?.prelims?.teams, rerank: confirmed?.rerank?.teams }],
  ])
  const placed = new Map<string, PlacedTeam[]>()
  for (const [id, teams] of counting) {
    const scheduleQuizId = links.get(id)
    if (scheduleQuizId !== undefined) placed.set(scheduleQuizId, teams)
  }
  const teamNames = new Map((facts.teams ?? []).map((team) => [team.id, team.name]))
  return resolveBenches(doc, division, {
    orders,
    placed,
    tieBreaks,
    teamName: (teamId) => teamNames.get(teamId),
  })
}
