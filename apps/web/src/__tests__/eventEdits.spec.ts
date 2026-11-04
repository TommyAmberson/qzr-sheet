import { describe, expect, it } from 'vitest'
import { newScheduleDocument, type ScheduleDocument } from '@qzr/shared'

import { editEvent, moveEvent } from '../builder/edits'

function doc(): ScheduleDocument {
  const d = newScheduleDocument('Meet')
  d.frame = [{ kind: 'slot', id: 's1', at: 8 * 60, minutes: 60, use: 'event' }]
  d.rooms = ['r1', 'r2', 'r3'].map((id) => ({ id, name: id }))
  d.events = [
    { id: 'a', label: 'Breakfast', slot: 's1', rooms: ['r1'], pinned: false },
    { id: 'b', label: 'Coffee', slot: 's1', rooms: ['r3'], pinned: false },
  ]
  return d
}

describe('events of the same name in one slot are one event (FR-017)', () => {
  it('joins an event renamed to its neighbour', () => {
    const d = doc()
    editEvent(d, 'b', { label: 'Breakfast' })
    expect(d.events.map((e) => [e.id, e.rooms])).toEqual([['a', ['r1', 'r3']]])
  })

  it('becomes all rooms once it has every one', () => {
    const d = doc()
    d.events.push({ id: 'c', label: 'Breakfast', slot: null, rooms: ['r1'], pinned: false })
    editEvent(d, 'b', { label: 'Breakfast' })
    moveEvent(d, 'c', { slot: 's1', room: 'r2' })
    expect(d.events.map((e) => [e.id, e.rooms])).toEqual([['a', 'all']])
  })
})
