import { describe, expect, it } from 'vitest'
import { newScheduleDocument } from '@qzr/shared'

import type { MeetTeamRow } from '../api'
import { reconcileTeams } from '../builder/linked'

const team = (id: number, division: string): MeetTeamRow => ({
  id,
  churchId: 1,
  churchName: 'Grace',
  churchShortName: 'Grace',
  division,
  number: id,
  consolation: false,
  lateness: false,
})

describe("following the meet's teams (FR-047)", () => {
  it("lets go of the last team a division had, so the draft doesn't name it", () => {
    const doc = newScheduleDocument('Meet')
    doc.settings.divisions = [
      { id: '1', name: 'Div 1', teams: 1, elims: { lanes: [], lines: [] } },
      { id: '2', name: 'Div 2', teams: 1, elims: { lanes: [], lines: [] } },
    ]
    doc.draw = {
      '1': { stale: false, teams: [{ teamId: 1, late: false, absent: false, letter: 'A' }] },
      '2': { stale: false, teams: [{ teamId: 2, late: false, absent: false, letter: 'A' }] },
    }
    // Team 2, Div 2's only team, has left the meet
    expect(reconcileTeams(doc, [team(1, '1')])).toBe(true)
    expect(doc.draw['2']).toEqual({ stale: true, teams: [] })
    // Div 2 keeps the count it was built with
    expect(doc.settings.divisions[1]!.teams).toBe(1)
  })
})
