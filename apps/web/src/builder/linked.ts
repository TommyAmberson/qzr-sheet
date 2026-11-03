import {
  defaultElims,
  generateSchedule,
  newScheduleDocument,
  type ScheduleDocument,
} from '@qzr/shared'

import type { MeetRoom, MeetTeamRow, QuizMeet } from '../api'

/**
 * A meet's linked schedule in this browser: the draft is kept like any schedule (persistence.ts),
 * and this record says which server revision it's based on and whether it has changes not yet sent,
 * so a reload sends them (FR-048a).
 */
export interface LinkState {
  docId: string
  baseRevision: number
  unsent: boolean
}

const linkKey = (meetId: number) => `qzr-schedule-link:${meetId}`

export function readLink(meetId: number): LinkState | null {
  try {
    const raw = localStorage.getItem(linkKey(meetId))
    return raw ? (JSON.parse(raw) as LinkState) : null
  } catch {
    return null
  }
}

export function writeLink(meetId: number, state: LinkState) {
  try {
    localStorage.setItem(linkKey(meetId), JSON.stringify(state))
  } catch {
    // Storage full or unavailable: the save still goes to the server
  }
}

export function forgetLink(meetId: number) {
  localStorage.removeItem(linkKey(meetId))
}

/** The browser's time zone, which the meet's days are in */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const teamName = (t: MeetTeamRow) => `${t.churchShortName} ${t.number}`

/**
 * A new schedule from the meet (story 7 scenario 1, FR-047): its divisions and team counts, a draw
 * of its teams with their late marks, and its rooms, in order, standing in for the generated ones.
 */
export function startFromMeet(
  meet: QuizMeet,
  teams: MeetTeamRow[],
  rooms: MeetRoom[],
): ScheduleDocument {
  const doc = newScheduleDocument(meet.name)
  doc.link = { meetId: meet.id, timeZone: browserTimeZone() }
  const divisions = [...new Set([...meet.divisions, ...teams.map((t) => t.division)])]
  doc.settings.divisions = divisions.map((d) => {
    const count = teams.filter((t) => t.division === d).length
    return { id: d, name: `Div ${d}`, teams: count, elims: defaultElims(count) }
  })
  if (rooms.length > 0) doc.settings.rooms = rooms.length
  for (const d of divisions) {
    doc.draw[d] = {
      stale: false,
      teams: teams
        .filter((t) => t.division === d)
        .map((t) => ({ teamId: t.id, name: teamName(t), late: t.lateness, absent: false })),
    }
  }
  const generated = generateSchedule(doc)
  const ordered = [...rooms].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  generated.rooms.forEach((room, i) => {
    const meetRoom = ordered[i]
    if (!meetRoom) return
    room.name = meetRoom.name
    room.meetRoomId = meetRoom.id
  })
  return generated
}

/** The draw's team names from the meet, which owns them when linked (FR-047) */
export function withMeetNames(doc: ScheduleDocument, teams: MeetTeamRow[]): ScheduleDocument {
  const byId = new Map(teams.map((t) => [t.id, t]))
  for (const draw of Object.values(doc.draw)) {
    for (const t of draw.teams) {
      const team = t.teamId === undefined ? undefined : byId.get(t.teamId)
      if (team) t.name = teamName(team)
    }
  }
  return doc
}

/** Whether the draft differs from the newest published version ("unpublished changes") */
export function differsFromPublished(
  draft: ScheduleDocument,
  published: ScheduleDocument | null,
): boolean {
  if (!published) return true
  // Team names are filled from the meet on load, so they don't count as a change
  const strip = (d: ScheduleDocument) =>
    JSON.stringify({
      ...d,
      draw: Object.fromEntries(
        Object.entries(d.draw).map(([k, v]) => [
          k,
          { ...v, teams: v.teams.map(({ name: _name, ...t }) => t) },
        ]),
      ),
    })
  return strip(draft) !== strip(published)
}
