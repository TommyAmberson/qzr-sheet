import { describe, expect, it } from 'vitest'
import { newScheduleDocument, type ScheduleDocument } from '@qzr/shared'

import * as schema from '../../db/schema'
import { documentFromLegacy, legacyFromDocument, type LegacySchedule } from '../scheduleLegacy'

const meet = { id: 1, dateFrom: '2026-03-06' }
const at = new Date('2026-03-01T00:00:00Z')

function doc(quizIds: string[]): ScheduleDocument {
  const d = newScheduleDocument('Meet')
  d.link = { meetId: 1, timeZone: 'UTC' }
  d.frame = [
    { kind: 'day', id: 'sat', label: 'Saturday' },
    { kind: 'slot', id: 's1', at: 9 * 60, minutes: 25 },
    { kind: 'day', id: 'mon', label: 'Monday' },
    { kind: 'slot', id: 's2', at: 9 * 60, minutes: 25 },
  ]
  d.rooms = [{ id: 'r1', name: 'Room 1', meetRoomId: 7 }]
  d.quizzes = quizIds.map((id) => ({
    id,
    label: `Div 1 Quiz ${id}`,
    division: '1',
    phase: 'prelim',
    cell: { slot: 's1', room: 'r1' },
    seats: [],
    pinned: false,
  }))
  return d
}

describe('legacyFromDocument', () => {
  it('dates each day on its weekday from the meet start, gaps included', () => {
    const view = legacyFromDocument(doc([]), meet, at)
    expect(view.slots.map((s) => s.startAt)).toEqual([
      '2026-03-07T09:00:00.000Z',
      '2026-03-09T09:00:00.000Z',
    ])
  })

  it('puts a first day before a start entered a day late on its own date', () => {
    const view = legacyFromDocument(doc([]), { id: 1, dateFrom: '2026-03-08' }, at)
    // Saturday 7 March, not the Saturday a week after the Sunday start
    expect(view.slots[0]!.startAt).toBe('2026-03-07T09:00:00.000Z')
  })

  it('reports a slot holding events and no quizzes as an event', () => {
    const d = doc(['a'])
    d.events = [
      { id: 'cm', label: 'Coaches meeting', slot: 's1', rooms: ['r1'], pinned: true },
      { id: 'l', label: 'Lunch', slot: 's2', rooms: 'all', pinned: true },
    ]
    const view = legacyFromDocument(d, meet, at)
    expect(view.slots.map((s) => [s.kind, s.eventLabel])).toEqual([
      ['quiz', null],
      ['event', 'Lunch'],
    ])
  })

  it("keeps a quiz's number when quizzes are added before it", () => {
    const before = legacyFromDocument(doc(['b']), meet, at).quizzes[0]!.id
    const after = legacyFromDocument(doc(['a', 'b']), meet, at).quizzes.find(
      (q) => q.label === 'Div 1 Quiz b',
    )!.id
    expect(after).toBe(before)
  })
})

describe('documentFromLegacy', () => {
  /** An old one-division schedule of `quizzes` prelims, every one seating teams A, B and C */
  function old(quizzes: number, slot: Partial<schema.MeetSlot> = {}): LegacySchedule {
    const slots = Array.from({ length: quizzes }, (_, i) => ({
      id: i + 1,
      meetId: 1,
      startAt: new Date(Date.UTC(2026, 2, 7, 15, i * 25)),
      durationMinutes: 25,
      kind: 'quiz' as const,
      eventLabel: null,
      sortOrder: i,
      ...slot,
    })) as schema.MeetSlot[]
    const quizRows = slots.map((s, i) => ({
      id: i + 1,
      meetId: 1,
      slotId: s.id,
      roomId: 7,
      division: '1',
      phase: 'prelim' as const,
      lane: null,
      label: `D1-Q${i + 1}`,
      bracketLabel: null,
      publishedAt: null,
      completedAt: null,
    })) as schema.ScheduledQuiz[]
    const seats = quizRows.flatMap((q) =>
      ['A', 'B', 'C'].map((letter, n) => ({
        id: q.id * 10 + n,
        quizId: q.id,
        seatNumber: n + 1,
        letter,
        seedRef: null,
      })),
    ) as schema.ScheduledQuizSeat[]
    return {
      meet: { id: 1, name: 'Old meet', divisions: ['1'] },
      rooms: [{ id: 7, name: 'Room 1' }],
      slots,
      quizzes: quizRows,
      seats,
      assignments: [],
      teams: [],
    }
  }

  it('keeps the prelims per team the old schedule ran, so H-9 holds', () => {
    expect(documentFromLegacy(old(3), 'UTC').settings.quizzesPerTeam).toBe(3)
    expect(documentFromLegacy(old(6), 'UTC').settings.quizzesPerTeam).toBe(6)
  })

  it('makes an old slot of part minutes a whole number of minutes', () => {
    const d = documentFromLegacy(old(1, { durationMinutes: 12.5 }), 'UTC')
    expect(d.frame.flatMap((r) => (r.kind === 'slot' ? [r.minutes] : []))).toEqual([13])
  })

  it('numbers a quiz with an empty bracket label from its label, as the old scoresheet did', () => {
    const o = old(1)
    o.quizzes[0] = { ...o.quizzes[0]!, label: 'D1-Q7', bracketLabel: '' }
    expect(documentFromLegacy(o, 'UTC').quizzes[0]!.label).toBe('Div 1 Quiz 7')
  })
})
