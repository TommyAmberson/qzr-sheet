import { describe, it, expect } from 'vitest'

import { buildGrid, hasAnyQuiz } from '../scheduleGrid'
import type { MeetRoom, MeetSlot, ScheduledQuiz } from '../api'

function room(id: number, name: string, sortOrder: number): MeetRoom {
  return { id, name, sortOrder, hasCode: false }
}

function slot(id: number, sortOrder: number, kind: 'quiz' | 'event' = 'quiz'): MeetSlot {
  return {
    id,
    meetId: 1,
    startAt: '2026-05-08T13:00:00.000Z',
    durationMinutes: 25,
    kind,
    eventLabel: kind === 'event' ? 'Breakfast' : null,
    sortOrder,
  }
}

function quiz(
  id: number,
  slotId: number,
  roomId: number,
  division = 'Div 1',
  overrides: Partial<ScheduledQuiz> = {},
): ScheduledQuiz {
  return {
    id,
    meetId: 1,
    slotId,
    roomId,
    division,
    phase: 'prelim',
    lane: null,
    label: `Q${id}`,
    bracketLabel: null,
    publishedAt: null,
    completedAt: null,
    seats: [],
    ...overrides,
  }
}

describe('buildGrid', () => {
  it('orders rooms by sortOrder then id', () => {
    const grid = buildGrid([room(2, 'B', 2), room(1, 'A', 1), room(3, 'C', 1)], [], [], null)
    expect(grid.rooms.map((r) => r.id)).toEqual([1, 3, 2])
  })

  it('orders rows by slot sortOrder then id', () => {
    const grid = buildGrid([room(1, 'A', 0)], [slot(2, 2), slot(1, 1)], [], null)
    expect(grid.rows.map((r) => r.slot.id)).toEqual([1, 2])
  })

  it('places quizzes into their (slot, room) cells; missing cells are null', () => {
    const rooms = [room(1, 'A', 0), room(2, 'B', 1)]
    const slots = [slot(1, 0)]
    const quizzes = [quiz(10, 1, 1)]
    const grid = buildGrid(rooms, slots, quizzes, null)
    expect(grid.rows).toHaveLength(1)
    expect(grid.rows[0]!.cells.map((c) => c?.id ?? null)).toEqual([10, null])
  })

  it('event rows have no cells (spanned by the renderer)', () => {
    const grid = buildGrid([room(1, 'A', 0)], [slot(1, 0, 'event')], [], null)
    expect(grid.rows[0]!.cells).toEqual([])
  })

  it('division filter hides off-division quizzes but keeps the slot row', () => {
    const rooms = [room(1, 'A', 0), room(2, 'B', 1)]
    const slots = [slot(1, 0)]
    const quizzes = [quiz(10, 1, 1, 'Div 1'), quiz(11, 1, 2, 'Div 2')]
    const grid = buildGrid(rooms, slots, quizzes, 'Div 1')
    expect(grid.rows[0]!.cells.map((c) => c?.id ?? null)).toEqual([10, null])
  })

  it('null divisionFilter passes all quizzes through', () => {
    const rooms = [room(1, 'A', 0), room(2, 'B', 1)]
    const slots = [slot(1, 0)]
    const quizzes = [quiz(10, 1, 1, 'Div 1'), quiz(11, 1, 2, 'Div 2')]
    const grid = buildGrid(rooms, slots, quizzes, null)
    expect(grid.rows[0]!.cells.map((c) => c?.id ?? null)).toEqual([10, 11])
  })
})

describe('hasAnyQuiz', () => {
  it('is false for an empty grid', () => {
    const grid = buildGrid([room(1, 'A', 0)], [slot(1, 0)], [], null)
    expect(hasAnyQuiz(grid)).toBe(false)
  })

  it('is true when at least one cell holds a quiz', () => {
    const grid = buildGrid([room(1, 'A', 0)], [slot(1, 0)], [quiz(10, 1, 1)], null)
    expect(hasAnyQuiz(grid)).toBe(true)
  })

  it('is false when all quizzes are filtered out by division', () => {
    const grid = buildGrid([room(1, 'A', 0)], [slot(1, 0)], [quiz(10, 1, 1, 'Div 2')], 'Div 1')
    expect(hasAnyQuiz(grid)).toBe(false)
  })
})
