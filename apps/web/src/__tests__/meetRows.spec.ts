import { describe, it, expect } from 'vitest'
import { MeetRole } from '@qzr/shared'
import { meetRows } from '../meetRows'
import type { MeetMembership } from '../api'

const heritage = { meetId: 3, meetName: 'Heritage', viewerCode: 'fall-2026' }
const official = (room: string, roomId: number): MeetMembership => ({
  ...heritage,
  role: MeetRole.Official,
  label: room,
  roomId,
})

describe('meetRows', () => {
  it('lists a meet once for an official of several rooms, naming the rooms', () => {
    const rows = meetRows([official('Room 1', 1), official('Room 2', 2), official('Room 3', 3)])
    expect(rows).toEqual([{ ...heritage, roles: 'official: Room 1, Room 2, Room 3' }])
  })

  it('names each role once, in the order the memberships come, and keeps meets apart', () => {
    const south = { meetId: 2, meetName: 'South', viewerCode: 'south-1d-2026' }
    const rows = meetRows([
      { ...heritage, role: MeetRole.Admin },
      official('Room 1', 1),
      { ...south, role: MeetRole.HeadCoach, label: 'Alpha Church', churchId: 4 },
      { ...heritage, role: MeetRole.Viewer },
    ])
    expect(rows).toEqual([
      { ...heritage, roles: 'admin · official: Room 1 · viewer' },
      { ...south, roles: 'head coach' },
    ])
  })
})
