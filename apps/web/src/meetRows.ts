import { MeetRole } from '@qzr/shared'
import type { MeetMembership } from './api'

/** One meet of the account's, as the home page lists it */
export interface MeetRow {
  meetId: number
  meetName: string
  viewerCode: string
  /** The account's roles in the meet, an official's with its rooms: "admin · official: Room 1, Room 2" */
  roles: string
}

/**
 * The account's memberships, one row per meet in the order they first appear: the API gives an
 * official one membership per room, and an account can hold several roles in one meet.
 */
export function meetRows(memberships: MeetMembership[]): MeetRow[] {
  const rows = new Map<number, MeetRow & { byRole: Map<MeetRole, string[]> }>()
  for (const m of memberships) {
    let row = rows.get(m.meetId)
    if (!row) {
      row = {
        meetId: m.meetId,
        meetName: m.meetName,
        viewerCode: m.viewerCode,
        roles: '',
        byRole: new Map(),
      }
      rows.set(m.meetId, row)
    }
    const rooms = row.byRole.get(m.role) ?? []
    if (m.role === MeetRole.Official && m.label && !rooms.includes(m.label)) rooms.push(m.label)
    row.byRole.set(m.role, rooms)
  }
  return [...rows.values()].map(({ byRole, ...row }) => ({
    ...row,
    roles: [...byRole]
      .map(([role, rooms]) => {
        const name = role.replace('_', ' ')
        return rooms.length > 0 ? `${name}: ${rooms.join(', ')}` : name
      })
      .join(' · '),
  }))
}
