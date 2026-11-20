import { byNumber, teamDisplayName } from '@qzr/shared'
import type { MeetTeamRow, RosterExportEntry } from './api'

/** A team as the Roster tab lists it */
export interface RosterTeam {
  id: number
  name: string
  division: string
  quizzers: string[]
}

/**
 * The teams the Roster tab lists under each church, by church id: those of the meet's teams the
 * reader got back that are in the division picked, ordered by division and then number, each with
 * its quizzers. A church none of whose teams are listed is left out.
 */
export function rosterByChurch(
  teams: MeetTeamRow[],
  entries: RosterExportEntry[],
  inDivision: (division: string) => boolean,
): Map<number, RosterTeam[]> {
  const quizzersByTeam = new Map<number, string[]>()
  for (const entry of entries) {
    const names = quizzersByTeam.get(entry.teamId) ?? []
    names.push(entry.quizzerName)
    quizzersByTeam.set(entry.teamId, names)
  }

  const listed = teams
    .filter((team) => inDivision(team.division))
    .sort((a, b) => byNumber.compare(a.division, b.division) || a.number - b.number)

  const byChurch = new Map<number, RosterTeam[]>()
  for (const team of listed) {
    const churchTeams = byChurch.get(team.churchId) ?? []
    churchTeams.push({
      id: team.id,
      name: teamDisplayName({ shortName: team.churchShortName, number: team.number }),
      division: team.division,
      quizzers: quizzersByTeam.get(team.id) ?? [],
    })
    byChurch.set(team.churchId, churchTeams)
  }
  return byChurch
}
