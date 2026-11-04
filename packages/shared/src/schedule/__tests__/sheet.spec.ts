import { describe, expect, it } from 'vitest'
import { basicRows, formatClock, roomDivisions, seatText, sheetRows, statsBreaks } from '../sheet'
import { at, doc, quiz, seats } from './fixtures'

describe('the printed sheet', () => {
  it('formats times as the printouts do', () => {
    expect([0, 9 * 60, 12 * 60 + 5, 20 * 60].map(formatClock)).toEqual([
      '12:00 AM',
      '9:00 AM',
      '12:05 PM',
      '8:00 PM',
    ])
  })

  it('shows each kind of seat (FR-035), and drawn teams in Teams view (FR-043)', () => {
    const d = doc({
      quizzes: [
        quiz('A', { label: 'Div 1 Quiz A', seats: seats('A', '3', 'N10') }),
        quiz('B', { label: 'Div 1 Quiz B', seats: seats('2ofA', 'P1', '_') }),
      ],
    })
    d.draw.d1 = {
      stale: false,
      teams: [{ name: 'Northside 1', late: false, absent: false, letter: 'A' }],
    }
    const [a, b] = d.quizzes
    expect(a!.seats.map((s) => seatText(d, a!, s, 'letters'))).toEqual(['A', '3', 'New 10'])
    expect(seatText(d, a!, a!.seats[0]!, 'teams')).toBe('Northside 1')
    // An unnamed team goes by its place in the list
    d.draw.d1.teams[0]!.name = undefined
    expect(seatText(d, a!, a!.seats[0]!, 'teams')).toBe('Team 1')
    expect(b!.seats.map((s) => seatText(d, b!, s, 'letters'))).toEqual([
      '2 of A',
      '1st in pts',
      'Choose…',
    ])
  })

  it("lays the grid out by row, a one-room event taking its room's cell (H-3)", () => {
    const d = doc({ quizzes: [quiz('q1', { cell: at('s1', 'r1') })] })
    d.frame.push({
      kind: 'event',
      id: 'meet',
      at: 20 * 60,
      minutes: 25,
      label: 'Coaches meeting',
      room: 'r2',
    })
    const rows = sheetRows(d)
    const first = rows.find((r) => r.kind === 'slot')
    expect(first?.kind === 'slot' && first.cells.map((c) => [c.quiz?.id ?? null, c.event])).toEqual(
      [
        ['q1', null],
        [null, 'Coaches meeting'],
      ],
    )
    expect(rows.some((r) => r.kind === 'event')).toBe(false)
  })

  it('lists the divisions using a room, Finals aside (FR-019)', () => {
    const d = doc({
      quizzes: [
        quiz('q1', { cell: at('s1', 'r1') }),
        quiz('f', { division: 'd2', label: 'Div 2 Finals', deciding: true, cell: at('s2', 'r1') }),
      ],
    })
    d.settings.divisions.push({
      id: 'd2',
      name: 'Div 2',
      teams: 6,
      elims: { lanes: [], lines: [] },
    })
    expect(roomDivisions(d, 'r1')).toEqual(['Div 1'])
  })
})

describe('statsBreaks', () => {
  it("runs from a division's last prelim to its first elim (FR-020)", () => {
    const d = doc({
      quizzes: [
        quiz('p', { cell: at('s1') }),
        quiz('e', { phase: 'elim', lane: 0, cell: at('s3'), seats: seats('1', '2', '3') }),
      ],
    })
    expect(statsBreaks(d)).toEqual([{ division: 'Div 1', from: 20 * 60 + 25, to: 20 * 60 + 50 }])
  })
})

describe('basicRows', () => {
  it('collapses each run of slots into one Quizzing row between the events (FR-044)', () => {
    const d = doc()
    d.frame.splice(4, 0, { kind: 'event', id: 'snack', at: 21 * 60, minutes: 15, label: 'Snack' })
    expect(basicRows(d).map((r) => `${r.kind} ${r.label}`)).toEqual([
      'day Friday',
      'quizzing Quizzing',
      'event Snack',
      'quizzing Quizzing',
    ])
  })
})
