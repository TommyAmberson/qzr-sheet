import { describe, it, expect } from 'vitest'
import type { MeetTeamRow, RosterExportEntry } from '../api'
import { rosterByChurch } from '../rosterView'

function team(id: number, churchId: number, division: string, number: number): MeetTeamRow {
  return {
    id,
    churchId,
    churchName: `Church ${churchId}`,
    churchShortName: `C${churchId}`,
    division,
    number,
    consolation: false,
    lateness: false,
  }
}

function quizzer(teamId: number, churchId: number, quizzerName: string): RosterExportEntry {
  return {
    churchId,
    churchName: `Church ${churchId}`,
    churchShortName: `C${churchId}`,
    teamId,
    teamNumber: 0,
    division: '',
    quizzerName,
  }
}

const every = () => true

describe('rosterByChurch', () => {
  it("groups each church's teams by division and number, each with its quizzers", () => {
    const teams = [team(3, 1, '2', 2), team(1, 1, '1', 1), team(2, 2, '1', 1)]
    const entries = [quizzer(1, 1, 'Ann'), quizzer(1, 1, 'Ben'), quizzer(3, 1, 'Cal')]

    const roster = rosterByChurch(teams, entries, every)

    expect(roster.get(1)).toEqual([
      { id: 1, name: 'C1 1', division: '1', quizzers: ['Ann', 'Ben'] },
      { id: 3, name: 'C1 2', division: '2', quizzers: ['Cal'] },
    ])
    expect(roster.get(2)).toEqual([{ id: 2, name: 'C2 1', division: '1', quizzers: [] }])
  })

  it('keeps only the picked division, and leaves out a church with none in it', () => {
    const teams = [team(1, 1, '1', 1), team(2, 1, '2', 2), team(3, 2, '2', 1)]

    const roster = rosterByChurch(teams, [], (division) => division === '1')

    expect([...roster.keys()]).toEqual([1])
    expect(roster.get(1)!.map((t) => t.id)).toEqual([1])
  })
})
