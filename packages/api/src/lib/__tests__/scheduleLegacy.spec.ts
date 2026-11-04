import { describe, expect, it } from 'vitest'
import { newScheduleDocument, type ScheduleDocument } from '@qzr/shared'

import { legacyFromDocument } from '../scheduleLegacy'

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
