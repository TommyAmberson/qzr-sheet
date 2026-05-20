import { describe, it, expect } from 'vitest'

import { arrangeAllDivisions, type DivisionPlacementInput } from '../scheduleArrange'
import type { QuizDef } from '../scheduleBuild'
import { PRELIM_DRAW_PATTERNS } from '../prelimDraw'
import type { Row } from '../scheduleSort'
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

function rowsFor(teamCount: number): Row[] {
  return PRELIM_DRAW_PATTERNS[teamCount]!.map((r) => [r[0], r[1], r[2]] as Row)
}

function divInput(
  division: string,
  teamCount: number,
  lateLetters: string[] = [],
): DivisionPlacementInput {
  return {
    division,
    teamCount,
    rows: rowsFor(teamCount),
    lateLetters: new Set(lateLetters),
  }
}

/** Walk a plan and assert no letter appears twice in any (slot, div)
 *  pair. Returns null on success or a description of the first conflict. */
function findPlanConflict(plan: QuizDef[]): string | null {
  const bySlotDiv = new Map<string, Map<string, string>>()
  for (const def of plan) {
    const key = `${def.slotId}|${def.division}`
    let placed = bySlotDiv.get(key)
    if (!placed) {
      placed = new Map()
      bySlotDiv.set(key, placed)
    }
    for (const seat of def.seats) {
      if (!seat.letter) continue
      const existing = placed.get(seat.letter)
      if (existing) {
        return `Division ${def.division} slot ${def.slotId}: letter ${seat.letter} in ${existing} and ${def.label}`
      }
      placed.set(seat.letter, def.label)
    }
  }
  return null
}

function flattenPlan(result: ReturnType<typeof arrangeAllDivisions>): QuizDef[] {
  return [...result.perDivision.values()].flat()
}

describe('arrangeAllDivisions — combined allocator + placer', () => {
  it('produces gap-free quiz numbering per division', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15), divInput('3', 20)],
      slots,
      rooms,
    )
    for (const [div, defs] of result.perDivision) {
      const nums = defs.map((d) => Number(d.label.replace(`D${div}-Q`, '')))
      const sorted = [...nums].sort((a, b) => a - b)
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i], `division ${div} quiz numbering`).toBe(i + 1)
      }
    }
  })

  it('respects per-division team count (every row placed)', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15), divInput('3', 20)],
      slots,
      rooms,
    )
    expect(result.perDivision.get('1')).toHaveLength(9)
    expect(result.perDivision.get('2')).toHaveLength(15)
    expect(result.perDivision.get('3')).toHaveLength(20)
  })

  it('respects the ≤2-divisions-per-room invariant', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15), divInput('3', 20)],
      slots,
      rooms,
    )
    const divsByRoom = new Map<number, Set<string>>()
    for (const def of flattenPlan(result)) {
      let set = divsByRoom.get(def.roomId)
      if (!set) {
        set = new Set()
        divsByRoom.set(def.roomId, set)
      }
      set.add(def.division)
    }
    for (const [roomId, divs] of divsByRoom) {
      expect(divs.size, `room ${roomId}`).toBeLessThanOrEqual(2)
    }
  })

  it('9×5 D1=9 D2=15 D3=20 Populate: D1 conflict-free; total conflict count tracked', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15), divInput('3', 20)],
      slots,
      rooms,
    )
    const plan = flattenPlan(result)
    // D1 (single-room, K=1) must be conflict-free.
    expect(findPlanConflict(plan.filter((d) => d.division === '1'))).toBeNull()
  })

  it('9×5 with D3 lateness {S,T}: D3 produces no slot conflicts', () => {
    // This is the case the prior pipeline got wrong: D3 had a
    // TGP+KDT slot conflict in the late slot because the allocator
    // pre-fixed D3 to r3 at slots 2/5/8. The flexible algorithm can
    // shift D3 to take r3 at the early slots instead, where the
    // rule book's K=3 disjointness lines up cleanly.
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15), divInput('3', 20, ['S', 'T'])],
      slots,
      rooms,
    )
    const plan = flattenPlan(result)
    expect(findPlanConflict(plan.filter((d) => d.division === '3'))).toBeNull()
  })

  it('9×5 with D2 lateness: slot 1 of D2 contains no late letters', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15, ['J', 'K', 'L', 'M', 'N', 'O']), divInput('3', 20)],
      slots,
      rooms,
    )
    const d2Slot1 = result.perDivision.get('2')!.filter((d) => d.slotId === 100)
    expect(d2Slot1.length).toBeGreaterThan(0)
    const lateLetters = new Set(['J', 'K', 'L', 'M', 'N', 'O'])
    for (const quiz of d2Slot1) {
      for (const seat of quiz.seats) {
        expect(lateLetters.has(seat.letter ?? ''), `${quiz.label} seat ${seat.letter}`).toBe(false)
      }
    }
  })

  it('Populate (no lateness) for 20-team K=3 layout: zero conflicts', () => {
    const { slots, rooms } = makeGrid(7, 3)
    const result = arrangeAllDivisions([divInput('1', 20)], slots, rooms)
    expect(findPlanConflict(flattenPlan(result))).toBeNull()
  })

  it('exhaustive sweep: every team count in K=1 with and without lateness, no conflicts', () => {
    for (const teamCount of Object.keys(PRELIM_DRAW_PATTERNS).map(Number)) {
      const { slots, rooms } = makeGrid(teamCount, 1)
      const noLate = arrangeAllDivisions([divInput('1', teamCount)], slots, rooms)
      expect(findPlanConflict(flattenPlan(noLate)), `${teamCount} teams no lateness`).toBeNull()
      const lateLetter = String.fromCharCode(65 + teamCount - 1)
      const withLate = arrangeAllDivisions([divInput('1', teamCount, [lateLetter])], slots, rooms)
      expect(
        findPlanConflict(flattenPlan(withLate)),
        `${teamCount} teams with ${lateLetter} late`,
      ).toBeNull()
    }
  })

  it('lateness pushes late rows to higher quiz numbers within each division', () => {
    const { slots, rooms } = makeGrid(7, 3)
    const result = arrangeAllDivisions([divInput('1', 20, ['S', 'T'])], slots, rooms)
    const d3 = result.perDivision.get('1')!
    const lateLetters = new Set(['S', 'T'])
    // Find the highest non-late quiz number and the lowest late quiz number.
    let lastNonLate = -1
    let firstLate = Infinity
    for (const quiz of d3) {
      const isLate = quiz.seats.some((s) => lateLetters.has(s.letter ?? ''))
      const num = Number(quiz.label.replace('D1-Q', ''))
      if (isLate) firstLate = Math.min(firstLate, num)
      else lastNonLate = Math.max(lastNonLate, num)
    }
    expect(lastNonLate).toBeLessThan(firstLate)
  })

  it('records empty cells when team counts < grid capacity', () => {
    const { slots, rooms } = makeGrid(9, 5)
    // 9 + 15 + 20 = 44 in 45 cells → 1 empty.
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15), divInput('3', 20)],
      slots,
      rooms,
    )
    expect(result.emptyCellCount).toBe(1)
    expect(result.shortfall).toBe(0)
  })

  it('records shortfall when team counts exceed grid capacity', () => {
    const { slots, rooms } = makeGrid(3, 3)
    // 5 + 5 = 10 in 9 cells → 1 short.
    const result = arrangeAllDivisions([divInput('1', 5), divInput('2', 5)], slots, rooms)
    expect(result.shortfall).toBe(1)
  })

  it('handles a single division spanning all rooms', () => {
    const { slots, rooms } = makeGrid(7, 3)
    const result = arrangeAllDivisions([divInput('1', 20)], slots, rooms)
    // 20 quizzes placed.
    expect(result.perDivision.get('1')).toHaveLength(20)
    expect(findPlanConflict(flattenPlan(result))).toBeNull()
  })

  it('quiz numbers correspond to placement order (row-major)', () => {
    const { slots, rooms } = makeGrid(3, 3)
    const result = arrangeAllDivisions([divInput('1', 9)], slots, rooms)
    const d1 = result.perDivision.get('1')!
    // Sort by quiz number, verify cells are in row-major order.
    d1.sort((a, b) => Number(a.label.replace('D1-Q', '')) - Number(b.label.replace('D1-Q', '')))
    let lastSlot = -Infinity
    let lastRoom = -Infinity
    for (const quiz of d1) {
      if (quiz.slotId > lastSlot) {
        lastSlot = quiz.slotId
        lastRoom = quiz.roomId
      } else {
        expect(quiz.slotId).toBe(lastSlot)
        expect(quiz.roomId).toBeGreaterThan(lastRoom)
        lastRoom = quiz.roomId
      }
    }
  })
})
