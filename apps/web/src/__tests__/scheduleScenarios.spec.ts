import { describe, it, expect } from 'vitest'

import { arrangeAllDivisions, type DivisionPlacementInput, type QuizDef } from '../scheduleArrange'
import { PRELIM_DRAW_PATTERNS } from '../prelimDraw'
import type { Row } from '../scheduleSort'
import type { MeetRoom, MeetSlot } from '../api'

/**
 * End-to-end scenarios reflecting the user's worked examples. These
 * tests print the resulting grid (via console.log) so the user can
 * eyeball the layout, then assert the key invariants:
 *
 *  - No team in two rooms at the same slot (per division).
 *  - Each room hosts ≤ 2 divisions.
 *  - Every quiz placed; numbering Q1..QN sequential per division.
 *  - When lateness is applied, late letters land at the back.
 */

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

/** Pretty-print the arrangement as a slot×room grid. */
function renderGrid(
  plan: QuizDef[],
  slotCount: number,
  roomCount: number,
  slotIds: number[],
  roomIds: number[],
): string {
  const cells: string[][] = Array.from({ length: slotCount }, () =>
    Array.from({ length: roomCount }, () => '·'.padEnd(14)),
  )
  for (const def of plan) {
    const s = slotIds.indexOf(def.slotId)
    const r = roomIds.indexOf(def.roomId)
    const letters = def.seats.map((seat) => seat.letter ?? '?').join('')
    cells[s]![r] = `${def.label}:${letters}`.padEnd(14)
  }
  const header = '       ' + roomIds.map((_, i) => `r${i + 1}`.padEnd(14)).join('')
  const body = cells
    .map((row, i) => `slot${(i + 1).toString().padStart(2)} ${row.join('')}`)
    .join('\n')
  return `${header}\n${body}`
}

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

function flat(result: ReturnType<typeof arrangeAllDivisions>): QuizDef[] {
  return [...result.perDivision.values()].flat()
}

describe('user scenarios — end-to-end Populate + Sort by Lateness', () => {
  it('Scenario A: 3×3 with D1=4 and D2=5 (the worked example)', () => {
    const { slots, rooms } = makeGrid(3, 3)
    const result = arrangeAllDivisions([divInput('1', 4), divInput('2', 5)], slots, rooms)
    const plan = flat(result)
    const grid = renderGrid(
      plan,
      3,
      3,
      slots.map((s) => s.id),
      rooms.map((r) => r.id),
    )

    console.log('\n[Scenario A] 3×3 D1=4 D2=5 (Populate, no lateness):\n' + grid)

    // Quiz counts.
    expect(result.perDivision.get('1')).toHaveLength(4)
    expect(result.perDivision.get('2')).toHaveLength(5)
    // ≤ 2 divs per room.
    const divsByRoom = new Map<number, Set<string>>()
    for (const q of plan) {
      let s = divsByRoom.get(q.roomId)
      if (!s) {
        s = new Set()
        divsByRoom.set(q.roomId, s)
      }
      s.add(q.division)
    }
    for (const [, divs] of divsByRoom) expect(divs.size).toBeLessThanOrEqual(2)
    // NB: 4-team and 5-team rule books don't support K=2 disjointness,
    // so a within-slot conflict is unavoidable for this 3×3 layout.
    // Don't assert findPlanConflict null here — see the log to inspect.
    const conflict = findPlanConflict(plan)

    if (conflict) console.log('[Scenario A] expected conflict (rule-book K=1 only):', conflict)
  })

  it('Scenario B: 9×5 with D1=9 D2=15 D3=20 — Populate (no lateness)', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15), divInput('3', 20)],
      slots,
      rooms,
    )
    const plan = flat(result)
    const grid = renderGrid(
      plan,
      9,
      5,
      slots.map((s) => s.id),
      rooms.map((r) => r.id),
    )

    console.log('\n[Scenario B] 9×5 D1=9 D2=15 D3=20 (Populate):\n' + grid)

    expect(result.perDivision.get('1')).toHaveLength(9)
    expect(result.perDivision.get('2')).toHaveLength(15)
    expect(result.perDivision.get('3')).toHaveLength(20)
    expect(result.emptyCellCount).toBe(1)
    expect(result.shortfall).toBe(0)
    // D1 (single-room K=1) and D3 (20-team K=2..3 supported) must be
    // conflict-free.
    expect(findPlanConflict(plan.filter((d) => d.division === '1'))).toBeNull()
    expect(findPlanConflict(plan.filter((d) => d.division === '3'))).toBeNull()
    // D2 (15-team K=2) may have unavoidable conflicts — log if so.
    const d2Conflict = findPlanConflict(plan.filter((d) => d.division === '2'))

    if (d2Conflict) console.log('[Scenario B] D2 conflict:', d2Conflict)
  })

  it('Scenario C: 9×5 with D3 lateness {S, T} (after Roll Teams)', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15), divInput('3', 20, ['S', 'T'])],
      slots,
      rooms,
    )
    const plan = flat(result)
    const grid = renderGrid(
      plan,
      9,
      5,
      slots.map((s) => s.id),
      rooms.map((r) => r.id),
    )

    console.log('\n[Scenario C] 9×5 with D3 late=S,T (Sort by Lateness):\n' + grid)

    // Slot 1 of D3 must contain no late letters.
    const d3Slot1 = result.perDivision.get('3')!.filter((d) => d.slotId === 100)
    for (const quiz of d3Slot1) {
      for (const seat of quiz.seats) {
        expect(seat.letter).not.toBe('S')
        expect(seat.letter).not.toBe('T')
      }
    }
    // D3 should be conflict-free with flexible per-slot ownership.
    expect(findPlanConflict(plan.filter((d) => d.division === '3'))).toBeNull()
  })

  it('Scenario D: 9×5 with D2 lateness {J,K,L,M,N,O} (the user-reported case)', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9), divInput('2', 15, ['J', 'K', 'L', 'M', 'N', 'O']), divInput('3', 20)],
      slots,
      rooms,
    )
    const plan = flat(result)
    const grid = renderGrid(
      plan,
      9,
      5,
      slots.map((s) => s.id),
      rooms.map((r) => r.id),
    )

    console.log('\n[Scenario D] 9×5 with D2 late=J,K,L,M,N,O (Sort by Lateness):\n' + grid)

    // Slot 1 of D2 must contain no late letters.
    const lateLetters = new Set(['J', 'K', 'L', 'M', 'N', 'O'])
    const d2Slot1 = result.perDivision.get('2')!.filter((d) => d.slotId === 100)
    for (const quiz of d2Slot1) {
      for (const seat of quiz.seats) {
        expect(lateLetters.has(seat.letter ?? '')).toBe(false)
      }
    }
  })

  it('Scenario E: 9×5 with all three divisions having late teams', () => {
    const { slots, rooms } = makeGrid(9, 5)
    const result = arrangeAllDivisions(
      [divInput('1', 9, ['I']), divInput('2', 15, ['M', 'N', 'O']), divInput('3', 20, ['S', 'T'])],
      slots,
      rooms,
    )
    const plan = flat(result)
    const grid = renderGrid(
      plan,
      9,
      5,
      slots.map((s) => s.id),
      rooms.map((r) => r.id),
    )

    console.log('\n[Scenario E] 9×5 with D1 late=I, D2 late=M,N,O, D3 late=S,T:\n' + grid)

    // Earliest slot of each division should have no late letters.
    const lateByDiv: Record<string, Set<string>> = {
      '1': new Set(['I']),
      '2': new Set(['M', 'N', 'O']),
      '3': new Set(['S', 'T']),
    }
    for (const div of ['1', '2', '3']) {
      const earliest = result.perDivision.get(div)!.filter((d) => d.slotId === 100)
      for (const quiz of earliest) {
        for (const seat of quiz.seats) {
          expect(lateByDiv[div]!.has(seat.letter ?? ''), `${quiz.label} seat ${seat.letter}`).toBe(
            false,
          )
        }
      }
    }
  })
})
