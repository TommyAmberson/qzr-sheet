import { editDistance, foldName } from '../results'

/** A team of a meet's roster, as a quiz's typed names are held against it */
export interface RosterTeam {
  id: number
  /** Its full name: the church's name and the team's number, "First Church 1" */
  name: string
  /** Its short name: the church's short name and the number, "FC 1" */
  shortName: string
  /** The team's quizzers, by name; empty when the team's roster has not been entered */
  quizzers: string[]
}

/** How many edits a typed team name may be from a roster team's and still be taken for a typo */
const TEAM_TYPO_EDITS = 2
/** The same for a church's short name, where two edits reach most other churches' */
const SHORT_NAME_TYPO_EDITS = 1

/** A name with case, punctuation and spacing set aside, so "st. john's 1" finds "St Johns 1" */
export function looseName(name: string): string {
  return foldName(name.replace(/[^\w\s]/g, ''))
}

/**
 * The roster team a typed name names outright, by its full name before its short one, and as
 * written before punctuation is set aside. The first listed wins, so list the likelier teams first.
 */
export function teamNamed<Team extends Pick<RosterTeam, 'name' | 'shortName'>>(
  typedName: string,
  teams: Team[],
): Team | undefined {
  const typed = foldName(typedName)
  if (typed === '') return undefined
  const loose = looseName(typedName)
  return (
    teams.find((team) => foldName(team.name) === typed) ??
    teams.find((team) => foldName(team.shortName) === typed) ??
    teams.find((team) => looseName(team.name) === loose || looseName(team.shortName) === loose)
  )
}

/**
 * The roster teams whose name, full or short, is a typo away from the typed one. Often more than
 * one: a church's second team is a single edit from its first, so the name alone never settles
 * which is meant.
 */
export function teamsNearName<Team extends Pick<RosterTeam, 'name' | 'shortName'>>(
  typedName: string,
  teams: Team[],
): Team[] {
  const typed = foldName(typedName)
  if (typed === '') return []
  return teams.filter(
    (team) =>
      editDistance(typed, foldName(team.name)) <= TEAM_TYPO_EDITS ||
      editDistance(typed, foldName(team.shortName)) <= SHORT_NAME_TYPO_EDITS,
  )
}
