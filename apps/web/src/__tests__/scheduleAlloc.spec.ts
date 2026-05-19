import { describe, it, expect } from 'vitest'

import { allocateCells } from '../scheduleAlloc'
import type { MeetRoom, MeetSlot } from '../api'

function room(id: number, sortOrder: number): MeetRoom {
  return { id, name: `R${id}`, sortOrder, hasCode: false }
}

function slot(id: number, sortOrder: number): MeetSlot {
  return {
    id,
    meetId: 1,
    startAt: '2026-05-08T13:00:00.000Z',
    durationMinutes: 25,
    kind: 'quiz',
    eventLabel: null,
    sortOrder,
  }
}

function makeGrid(slotCount: number, roomCount: number) {
  const slots = Array.from({ length: slotCount }, (_, i) => slot(100 + i, i))
  const rooms = Array.from({ length: roomCount }, (_, i) => room(10 + i, i))
  return { slots, rooms }
}

/** Render the allocation as a slot×room grid of division names. */
function toGrid(
  result: ReturnType<typeof allocateCells>,
  slotCount: number,
  roomCount: number,
  slotIds: number[],
  roomIds: number[],
): string[][] {
  const grid: string[][] = Array.from({ length: slotCount }, () =>
    Array.from({ length: roomCount }, () => '·'),
  )
  for (const [div, cells] of result.perDivision.entries()) {
    for (const cell of cells) {
      const s = slotIds.indexOf(cell.slotId)
      const r = roomIds.indexOf(cell.roomId)
      grid[s]![r] = div
    }
  }
  return grid
}

describe('allocateCells', () => {
  describe('worked example: 3 slots × 3 rooms, D1=4 D2=5', () => {
    const { slots, rooms } = makeGrid(3, 3)
    const result = allocateCells(['D1', 'D2'], { D1: 4, D2: 5 }, slots, rooms)
    const grid = toGrid(
      result,
      3,
      3,
      slots.map((s) => s.id),
      rooms.map((r) => r.id),
    )

    it('matches the user-pinned option-2 cell ownership', () => {
      // From the plan:
      //      r1  r2  r3
      // s1   D1  D2  D2
      // s2   D1  D1  D2
      // s3   D1  D2  D2
      expect(grid).toEqual([
        ['D1', 'D2', 'D2'],
        ['D1', 'D1', 'D2'],
        ['D1', 'D2', 'D2'],
      ])
    })

    it('places D1 Q1..Q4 in row-major order within its cells', () => {
      const d1 = result.perDivision.get('D1')!
      expect(d1).toEqual([
        { slotId: 100, roomId: 10 }, // Q1 (s1, r1)
        { slotId: 101, roomId: 10 }, // Q2 (s2, r1)
        { slotId: 101, roomId: 11 }, // Q3 (s2, r2)
        { slotId: 102, roomId: 10 }, // Q4 (s3, r1)
      ])
    })

    it('places D2 Q1..Q5 in row-major order within its cells', () => {
      const d2 = result.perDivision.get('D2')!
      expect(d2).toEqual([
        { slotId: 100, roomId: 11 }, // Q1 (s1, r2)
        { slotId: 100, roomId: 12 }, // Q2 (s1, r3)
        { slotId: 101, roomId: 12 }, // Q3 (s2, r3)
        { slotId: 102, roomId: 11 }, // Q4 (s3, r2)
        { slotId: 102, roomId: 12 }, // Q5 (s3, r3)
      ])
    })

    it('uses exactly the grid capacity (no shortfall, no empty)', () => {
      expect(result.shortfall).toBe(0)
      expect(result.emptyCellCount).toBe(0)
    })

    it('reports room ownership: r1=D1 only, r2 shared, r3=D2 only', () => {
      expect(result.roomOwnership.map((r) => r.entries)).toEqual([
        [{ division: 'D1', count: 3 }],
        [
          { division: 'D1', count: 1 },
          { division: 'D2', count: 2 },
        ],
        [{ division: 'D2', count: 3 }],
      ])
    })
  })

  describe('worked example: 9 slots × 5 rooms, D1=9 D2=15 D3=20', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = allocateCells(['D1', 'D2', 'D3'], { D1: 9, D2: 15, D3: 20 }, slots, rooms)
    const grid = toGrid(
      result,
      9,
      5,
      slots.map((s) => s.id),
      rooms.map((r) => r.id),
    )

    it('matches the pinned 5×9 cell ownership from the plan', () => {
      // From the plan:
      //        r1  r2  r3  r4  r5
      // s1     D1  D2  D2  D3  D3
      // s2     D1  D2  D3  D3  D3
      // s3     D1  D2  D2  D3  D3
      // s4     D1  D2  D2  D3  D3
      // s5     D1  D2  D3  D3  D3
      // s6     D1  D2  D2  D3  D3
      // s7     D1  D2  D2  D3  D3
      // s8     D1  D2  D3  D3  D3
      // s9     D1  D2  D2  D3  ·
      expect(grid).toEqual([
        ['D1', 'D2', 'D2', 'D3', 'D3'],
        ['D1', 'D2', 'D3', 'D3', 'D3'],
        ['D1', 'D2', 'D2', 'D3', 'D3'],
        ['D1', 'D2', 'D2', 'D3', 'D3'],
        ['D1', 'D2', 'D3', 'D3', 'D3'],
        ['D1', 'D2', 'D2', 'D3', 'D3'],
        ['D1', 'D2', 'D2', 'D3', 'D3'],
        ['D1', 'D2', 'D3', 'D3', 'D3'],
        ['D1', 'D2', 'D2', 'D3', '·'],
      ])
    })

    it('keeps each room at ≤2 divisions', () => {
      for (const { entries } of result.roomOwnership) {
        expect(entries.length).toBeLessThanOrEqual(2)
      }
    })

    it('places the empty cell at the bottom of the last room', () => {
      expect(result.emptyCellCount).toBe(1)
      expect(result.shortfall).toBe(0)
      // The empty cell should be the last (slot, room) in row-major =
      // (s9, r5) = (slotId 108, roomId 14).
      const d3 = result.perDivision.get('D3')!
      expect(d3.find((c) => c.slotId === 108 && c.roomId === 14)).toBeUndefined()
    })

    it('numbers each division row-major within its cells', () => {
      // D1 quizzes: Q1..Q9 in r1 slots 1..9.
      const d1 = result.perDivision.get('D1')!
      expect(d1.length).toBe(9)
      expect(d1.map((c) => c.roomId)).toEqual(Array(9).fill(10))
      expect(d1.map((c) => c.slotId)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108])

      // D3 first three quizzes: (s1, r4), (s1, r5), (s2, r3) — row-major
      // hits r4, r5 in s1 first, then r3 at s2 (which is the first D3
      // cell in r3 per the spread heuristic).
      const d3 = result.perDivision.get('D3')!
      expect(d3.slice(0, 5)).toEqual([
        { slotId: 100, roomId: 13 }, // D3-Q1 at (s1, r4)
        { slotId: 100, roomId: 14 }, // D3-Q2 at (s1, r5)
        { slotId: 101, roomId: 12 }, // D3-Q3 at (s2, r3)
        { slotId: 101, roomId: 13 }, // D3-Q4 at (s2, r4)
        { slotId: 101, roomId: 14 }, // D3-Q5 at (s2, r5)
      ])
    })
  })

  describe('capacity', () => {
    it('reports shortfall when divisions exceed capacity', () => {
      const { slots, rooms } = makeGrid(3, 3)
      const result = allocateCells(['D1', 'D2'], { D1: 5, D2: 5 }, slots, rooms)
      // 3*3 = 9 cells, 10 quizzes → 1 short.
      expect(result.shortfall).toBe(1)
    })

    it('reports zero shortfall when divisions fit exactly', () => {
      const { slots, rooms } = makeGrid(3, 3)
      const result = allocateCells(['D1'], { D1: 9 }, slots, rooms)
      expect(result.shortfall).toBe(0)
      expect(result.emptyCellCount).toBe(0)
    })
  })

  describe('sorted ordering', () => {
    it('respects slot/room sortOrder regardless of id', () => {
      // Build with rooms and slots given in non-sorted-order; verify the
      // allocator uses sortOrder.
      const rooms = [room(20, 1), room(10, 0)] // sortOrder 0=r10, 1=r20
      const slots = [slot(200, 1), slot(100, 0)] // sortOrder 0=s100, 1=s200
      const result = allocateCells(['D1'], { D1: 3 }, slots, rooms)
      const d1 = result.perDivision.get('D1')!
      // 2 slots × 2 rooms = 4 cells. D1=3. Fills row-major (s100, r10),
      // (s100, r20), (s200, r10), leaving (s200, r20) empty.
      expect(d1).toEqual([
        { slotId: 100, roomId: 10 },
        { slotId: 100, roomId: 20 },
        { slotId: 200, roomId: 10 },
      ])
      expect(result.emptyCellCount).toBe(1)
    })
  })
})
