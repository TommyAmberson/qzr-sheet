import {
  defaultElims,
  recommendedRooms,
  unappliedSettings,
  type ScheduleDocument,
  type ScheduleSettings,
} from '@qzr/shared'

export const DRAW_NAMES: Record<ScheduleSettings['prelimDraw'], string> = {
  ruleBook: 'Rule book',
  noRematches: 'No rematches',
}

const FRAME_NAMES: Record<ScheduleSettings['framePreset'], string> = {
  weekend: 'Weekend',
  oneDay: 'One day',
  oneRoom: 'One room',
}

/** A room count as the director chose it: a number, or the recommendation and what it comes to */
export function roomsText(settings: ScheduleSettings): string {
  return settings.rooms === 'auto'
    ? `${recommendedRooms(settings)} (recommended)`
    : `${settings.rooms}`
}

/**
 * The settings waiting for Apply, one line for each change the director made (FR-012a). A team
 * count and the default elims that follow it are one change.
 */
export function describeUnapplied(doc: ScheduleDocument): string[] {
  const now = doc.settings
  const was = doc.applied
  const list = unappliedSettings(doc)
  const lines: string[] = []
  for (const u of list) {
    const [id, field] = u.key.split('.') as [string, string | undefined]
    const division = now.divisions.find((d) => d.id === id)
    const before = was.divisions.find((d) => d.id === id)
    if (u.key === 'slotMinutes') {
      lines.push(`Slot length: ${was.slotMinutes} to ${now.slotMinutes} minutes`)
    } else if (u.key === 'rooms') {
      lines.push(`Rooms: ${roomsText(was)} to ${roomsText(now)}`)
    } else if (u.key === 'quizzesPerTeam') {
      lines.push(`Quizzes per team: ${was.quizzesPerTeam} to ${now.quizzesPerTeam}`)
    } else if (u.key === 'prelimDraw') {
      lines.push(`Prelim draw: ${DRAW_NAMES[was.prelimDraw]} to ${DRAW_NAMES[now.prelimDraw]}`)
    } else if (u.key === 'lateTeams') {
      lines.push(`Late teams play late: ${now.lateTeams ? 'on' : 'off'}`)
    } else if (u.key === 'framePreset') {
      lines.push(`Frame: ${FRAME_NAMES[was.framePreset]} to ${FRAME_NAMES[now.framePreset]}`)
    } else if (u.key === 'totallingMinutes') {
      lines.push(`Time to total: ${was.totallingMinutes} to ${now.totallingMinutes} minutes`)
    } else if (u.key === 'finals') {
      lines.push(
        `Finals: ${was.finals.sideBySide} to ${now.finals.sideBySide} side by side, ${was.finals.spacingMinutes} to ${now.finals.spacingMinutes} minutes apart`,
      )
    } else if (u.key === 'divisions') {
      const names = (s: ScheduleSettings) => s.divisions.map((d) => d.name).join(', ') || 'none'
      lines.push(`Divisions: ${names(was)} to ${names(now)}`)
    } else if (division && field === 'name') {
      lines.push(`${before?.name ?? division.name} renamed ${division.name}`)
    } else if (division && field === 'teams') {
      const follow = list.some((x) => x.key === `${id}.elims`) && followsTeams(division)
      lines.push(
        `${division.name}: ${before?.teams ?? 0} to ${division.teams} teams${follow ? ', its elims to suit' : ''}`,
      )
    } else if (division && field === 'elims') {
      const teamsToo = list.some((x) => x.key === `${id}.teams`)
      if (!(teamsToo && followsTeams(division))) lines.push(`${division.name}: elim settings`)
    }
  }
  return lines
}

/** Whether a division's elims are the defaults for its team count, which a new count changes */
function followsTeams(division: ScheduleSettings['divisions'][number]) {
  return JSON.stringify(division.elims) === JSON.stringify(defaultElims(division.teams))
}
