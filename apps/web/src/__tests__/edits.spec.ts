import { describe, expect, it } from 'vitest'
import { newScheduleDocument, type ScheduleDocument } from '@qzr/shared'

import { deleteRow, editEvent, editRow, insertRow, moveEvent, moveQuiz } from '../builder/edits'

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

  it('joins an all-rooms event moved beside one of its name', () => {
    const d = doc()
    d.frame.push({ kind: 'slot', id: 's2', at: 9 * 60, minutes: 60, use: 'event' })
    d.events.push({ id: 'c', label: 'Breakfast', slot: 's2', rooms: 'all', pinned: false })
    moveEvent(d, 'c', { slot: 's1', room: 'r1' })
    expect(d.events.filter((e) => e.label === 'Breakfast').map((e) => [e.id, e.rooms])).toEqual([
      ['a', 'all'],
    ])
  })

  it('becomes all rooms once it has every one', () => {
    const d = doc()
    d.events.push({ id: 'c', label: 'Breakfast', slot: null, rooms: ['r1'], pinned: false })
    editEvent(d, 'b', { label: 'Breakfast' })
    moveEvent(d, 'c', { slot: 's1', room: 'r2' })
    expect(d.events.map((e) => [e.id, e.rooms])).toEqual([['a', 'all']])
  })
})

describe('moving a quiz', () => {
  it('swaps with the quiz the grid draws when two share the cell', () => {
    const d = newScheduleDocument('Meet')
    d.rooms = [{ id: 'r1', name: 'Room 1' }]
    d.frame = [
      { kind: 'slot', id: 'a', at: 9 * 60, minutes: 25 },
      { kind: 'slot', id: 'b', at: 10 * 60, minutes: 25 },
    ]
    const q = (id: string, slot: string) => ({
      id,
      label: `Div 1 Quiz ${id}`,
      division: 'd1',
      phase: 'prelim' as const,
      cell: { slot, room: 'r1' },
      seats: [],
      pinned: false,
    })
    // 1 and 2 share cell a; the grid draws the last, 2
    d.quizzes = [q('1', 'a'), q('2', 'a'), q('3', 'b')]
    moveQuiz(d, '3', { slot: 'a', room: 'r1' })
    expect(d.quizzes.map((x) => `${x.id}@${x.cell!.slot}`)).toEqual(['1@a', '2@b', '3@a'])
  })

  it("sends the quiz it swaps out to the tray when the mover's old row is gone", () => {
    const d = newScheduleDocument('Meet')
    d.rooms = [{ id: 'r1', name: 'Room 1' }]
    d.frame = [{ kind: 'slot', id: 'a', at: 9 * 60, minutes: 25 }]
    const base = { division: 'd1', phase: 'prelim' as const, seats: [], pinned: false }
    d.quizzes = [
      { ...base, id: '1', label: 'Div 1 Quiz 1', cell: { slot: 'a', room: 'r1' } },
      { ...base, id: '2', label: 'Div 1 Quiz 2', cell: { slot: 'gone', room: 'r1' } },
    ]
    moveQuiz(d, '2', { slot: 'a', room: 'r1' })
    expect(d.quizzes.map((x) => x.cell?.slot ?? 'tray')).toEqual(['tray', 'a'])
  })
})

describe('moving an event', () => {
  it('keeps its rooms together, shifting back from the last room rather than losing one', () => {
    const d = doc()
    editEvent(d, 'a', { rooms: ['r1', 'r2'] })
    moveEvent(d, 'a', { slot: 's1', room: 'r3' })
    expect(d.events.find((e) => e.id === 'a')!.rooms).toEqual(['r2', 'r3'])
  })
})

describe("a day's rows never overlap (FR-016)", () => {
  function day(): ScheduleDocument {
    const d = newScheduleDocument('Meet')
    d.frame = [
      { kind: 'day', id: 'sat', label: 'Saturday' },
      { kind: 'slot', id: 'a', at: 9 * 60, minutes: 25 },
      { kind: 'note', id: 'n', text: 'Under a' },
      { kind: 'slot', id: 'b', at: 9 * 60 + 25, minutes: 25 },
      { kind: 'slot', id: 'c', at: 11 * 60, minutes: 25 },
      { kind: 'day', id: 'sun', label: 'Sunday' },
      { kind: 'slot', id: 'd', at: 9 * 60, minutes: 25 },
    ]
    return d
  }
  const times = (d: ScheduleDocument) =>
    d.frame.map((r) => (r.kind === 'slot' ? `${r.id}@${r.at}` : r.id))

  it('moves the rows after a longer one down only as far as they overlap', () => {
    const d = day()
    editRow(d, 'a', { minutes: 40 })
    // b moves down 15 minutes; c, after a gap, and Sunday stay
    expect(times(d)).toEqual(['sat', 'a@540', 'n', 'b@580', 'c@660', 'sun', 'd@540'])
  })

  it('makes room for an inserted row', () => {
    const d = day()
    insertRow(d, 'n', { kind: 'slot', id: 'x', at: 9 * 60 + 25, minutes: 30, use: 'event' })
    expect(times(d)).toEqual(['sat', 'a@540', 'n', 'x@565', 'b@595', 'c@660', 'sun', 'd@540'])
  })

  it("leaves every day's rows in order when a day is renamed", () => {
    const d = day()
    editRow(d, 'sun', { label: 'Sun' })
    expect(times(d)).toEqual(['sat', 'a@540', 'n', 'b@565', 'c@660', 'sun', 'd@540'])
  })

  it('puts a row retimed earlier in its place, its notes with it', () => {
    const d = day()
    editRow(d, 'a', { at: 10 * 60 })
    expect(times(d)).toEqual(['sat', 'b@565', 'a@600', 'n', 'c@660', 'sun', 'd@540'])
  })
})

describe('later rows follow an edited row (FR-016)', () => {
  function day(): ScheduleDocument {
    const d = newScheduleDocument('Meet')
    d.frame = [
      { kind: 'day', id: 'sat', label: 'Saturday' },
      { kind: 'slot', id: 'a', at: 9 * 60, minutes: 25 },
      { kind: 'slot', id: 'b', at: 9 * 60 + 25, minutes: 25 },
      { kind: 'slot', id: 'c', at: 11 * 60, minutes: 25 },
      { kind: 'day', id: 'sun', label: 'Sunday' },
      { kind: 'slot', id: 'd', at: 9 * 60, minutes: 25 },
    ]
    return d
  }
  const times = (d: ScheduleDocument) =>
    d.frame.flatMap((r) => (r.kind === 'slot' ? [`${r.id}@${r.at}`] : []))

  it('moves them by as much as a shorter row ends sooner, gaps kept', () => {
    const d = day()
    editRow(d, 'a', { minutes: 15 }, true)
    expect(times(d)).toEqual(['a@540', 'b@555', 'c@650', 'd@540'])
  })

  it('moves a row retimed later with the rows after it, in their order', () => {
    const d = day()
    editRow(d, 'a', { at: 10 * 60 + 30 }, true)
    expect(times(d)).toEqual(['a@630', 'b@655', 'c@750', 'd@540'])
  })

  it('closes the space of a deleted row', () => {
    const d = day()
    deleteRow(d, 'a', true)
    expect(times(d)).toEqual(['b@540', 'c@635', 'd@540'])
  })

  it('makes room for an inserted row past a gap', () => {
    const d = day()
    insertRow(d, 'a', { kind: 'slot', id: 'x', at: 9 * 60 + 25, minutes: 30 }, true)
    expect(times(d)).toEqual(['a@540', 'x@565', 'b@595', 'c@690', 'd@540'])
  })
})
