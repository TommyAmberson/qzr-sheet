import { teamDisplayName } from '@qzr/shared'
import type { MeetTeam } from './api'

/** A meet team's full name: "{churchName} {number}" */
export function teamFullName(team: MeetTeam): string {
  return `${team.churchName} ${team.number}`
}

/** A meet team's short name: "{shortName} {number}" */
export function teamShortName(team: MeetTeam): string {
  return teamDisplayName({ shortName: team.churchShortName, number: team.number })
}

/** Meet teams by both their names, for `teamNamed` and its kin */
export function teamsByName(teams: MeetTeam[]) {
  return teams.map((team) => ({
    id: team.id,
    name: teamFullName(team),
    shortName: teamShortName(team),
  }))
}
