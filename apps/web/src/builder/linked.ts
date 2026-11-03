import {
  defaultElims,
  setTeamCount,
  generateSchedule,
  newScheduleDocument,
  teamDisplayName,
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

/** Where the record lives when the browser can't keep it (storage full, or a private window) */
const unkept = new Map<number, LinkState>()

export function readLink(meetId: number): LinkState | null {
  try {
    const raw = localStorage.getItem(linkKey(meetId))
    if (raw) return JSON.parse(raw) as LinkState
  } catch {
    // Unavailable: fall back to this page's copy
  }
  return unkept.get(meetId) ?? null
}

export function writeLink(meetId: number, state: LinkState) {
  try {
    localStorage.setItem(linkKey(meetId), JSON.stringify(state))
    unkept.delete(meetId)
  } catch {
    // Storage full or unavailable: this page keeps it, so the save still goes to the server
    unkept.set(meetId, state)
  }
}

export function forgetLink(meetId: number) {
  unkept.delete(meetId)
  try {
    localStorage.removeItem(linkKey(meetId))
  } catch {
    // Nothing kept to forget
  }
}

/** The browser's time zone, which the meet's days are in */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** A meet team's name as the builder shows it */
export const teamName = (t: MeetTeamRow) =>
  teamDisplayName({ shortName: t.churchShortName, number: t.number })

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

/**
 * The schedule brought up to the meet's teams, which registration owns (FR-047): a team that left
 * is dropped from the draw and one that joined is added, a division's count follows the teams the
 * meet has registered in it, and a division the meet gained is added. A drawn division whose teams
 * changed needs its draw redone. A settings change: the builder applies it like any other, so it
 * waits for Apply when Auto-apply is off. Whether anything changed.
 */
export function reconcileTeams(doc: ScheduleDocument, teams: MeetTeamRow[]): boolean {
  let changed = false
  const registered = new Set(teams.map((t) => t.division))
  for (const id of registered) {
    if (doc.settings.divisions.some((d) => d.id === id)) continue
    doc.settings.divisions.push({ id, name: `Div ${id}`, teams: 0, elims: defaultElims(0) })
    changed = true
  }
  for (const division of doc.settings.divisions) {
    // A division with nothing registered yet keeps the count it was built with
    if (!registered.has(division.id)) continue
    const meetTeams = teams.filter((t) => t.division === division.id)
    if (setTeamCount(doc, division.id, meetTeams.length)) changed = true
    const draw = (doc.draw[division.id] ??= { teams: [], stale: false })
    const ids = new Set(meetTeams.map((t) => t.id))
    const kept = draw.teams.filter((t) => t.teamId === undefined || ids.has(t.teamId))
    const have = new Set(kept.map((t) => t.teamId))
    const joined = meetTeams
      .filter((t) => !have.has(t.id))
      .map((t) => ({ teamId: t.id, name: teamName(t), late: t.lateness, absent: false }))
    if (kept.length === draw.teams.length && joined.length === 0) continue
    changed = true
    if (draw.teams.some((t) => t.letter)) draw.stale = true
    draw.teams = [...kept, ...joined]
  }
  return changed
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

/**
 * A document in a form to compare a draft with the newest published version ("unpublished
 * changes"). Team names are filled from the meet on load, so they don't count as a change.
 */
export function comparable(d: ScheduleDocument): string {
  return JSON.stringify({
    ...d,
    draw: Object.fromEntries(
      Object.entries(d.draw).map(([k, v]) => [
        k,
        { ...v, teams: v.teams.map(({ name: _name, ...t }) => t) },
      ]),
    ),
  })
}
