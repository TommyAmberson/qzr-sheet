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

  it("keeps a quiz's number when quizzes are added before it", () => {
    const before = legacyFromDocument(doc(['b']), meet, at).quizzes[0]!.id
    const after = legacyFromDocument(doc(['a', 'b']), meet, at).quizzes.find(
      (q) => q.label === 'Div 1 Quiz b',
    )!.id
    expect(after).toBe(before)
  })
})
