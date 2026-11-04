import { describe, expect, it } from 'vitest'
import { drawPrelims } from '../prelimDraw'
import { placePrelims, type PrelimDivision, type PlacementResult } from '../placement'

const slots = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`)
const rooms = (n: number) => Array.from({ length: n }, (_, i) => `r${i + 1}`)

function division(id: string, teams: number): PrelimDivision {
  return {
    id,
    quizzes: drawPrelims(teams, 'ruleBook', 3).map((letters, i) => ({
      id: `${id}-${i + 1}`,
      letters,
    })),
  }
}

/** Every slot's quizzes of one division share no letter (H-1), and no cell holds two (H-2) */
function sound(divisions: PrelimDivision[], result: PlacementResult) {
  const cells = new Set<string>()
  const letters = new Set<string>()
  for (const d of divisions) {
    for (const q of d.quizzes) {
      const cell = result.cells.get(q.id)
      if (!cell) continue
      const key = `${cell.slot}|${cell.room}`
      expect(cells.has(key), `two quizzes in ${key}`).toBe(false)
      cells.add(key)
      for (const l of q.letters) {
        const k = `${cell.slot}|${d.id}|${l}`
        expect(letters.has(k), `${l} twice at ${cell.slot}`).toBe(false)
        letters.add(k)
      }
    }
  }
}

const roomsOf = (d: PrelimDivision, r: PlacementResult) =>
  [...new Set(d.quizzes.map((q) => r.cells.get(q.id)?.room))].sort()

describe('placePrelims', () => {
  it('FBC 2025: a block of rooms per division in division order, Div 2 borrowing Room 1 last', () => {
    const divisions = [division('d1', 6), division('d2', 17), division('d3', 16)]
    const result = placePrelims({ divisions, slots: slots(8), rooms: rooms(5), fixed: [] })
    sound(divisions, result)
    expect(result.unplaced).toEqual([])
    expect(roomsOf(divisions[0]!, result)).toEqual(['r1'])
    expect(roomsOf(divisions[2]!, result)).toEqual(['r4', 'r5'])
    const borrowed = divisions[1]!.quizzes.filter((q) => result.cells.get(q.id)?.room === 'r1')
    expect(borrowed.map((q) => result.cells.get(q.id)?.slot)).toEqual(['s8'])
  })

  it('packs a division from its first slot', () => {
    const divisions = [division('d1', 6), division('d2', 17), division('d3', 16)]
    const result = placePrelims({ divisions, slots: slots(8), rooms: rooms(5), fixed: [] })
    expect(divisions[0]!.quizzes.map((q) => result.cells.get(q.id)?.slot)).toEqual(slots(6))
  })

  it("Heritage 2025: Div 1 borrows Div 2's room only for the last rounds", () => {
    const divisions = [division('d1', 10), division('d2', 14), division('d3', 21)]
    const result = placePrelims({ divisions, slots: slots(8), rooms: rooms(6), fixed: [] })
    sound(divisions, result)
    expect(result.unplaced).toEqual([])
    // It borrows the nearest rooms, and only in its last rounds
    const borrowed = divisions[0]!.quizzes.filter((q) => result.cells.get(q.id)?.room !== 'r1')
    expect(borrowed).toHaveLength(2)
    for (const q of borrowed) {
      expect(['s7', 's8']).toContain(result.cells.get(q.id)?.slot)
      expect(['r2', 'r3']).toContain(result.cells.get(q.id)?.room)
    }
    expect(roomsOf(divisions[2]!, result)).toEqual(['r4', 'r5', 'r6'])
  })

  it('works around fixed quizzes and taken cells', () => {
    const divisions = [division('d1', 6)]
    const result = placePrelims({
      divisions,
      slots: slots(8),
      rooms: rooms(1),
      fixed: [{ slot: 's1', room: 'r1' }],
    })
    sound(divisions, result)
    expect(result.unplaced).toEqual([])
    expect(divisions[0]!.quizzes.some((q) => result.cells.get(q.id)?.slot === 's1')).toBe(false)
  })

  it("leaves what doesn't fit in the tray with the reason, never breaking a rule", () => {
    const divisions = [division('d1', 17)]
    const result = placePrelims({ divisions, slots: slots(3), rooms: rooms(2), fixed: [] })
    sound(divisions, result)
    expect(result.unplaced.length).toBe(17 - result.cells.size)
    expect(result.unplaced.length).toBeGreaterThan(0)
    expect(result.unplaced[0]!.reason).toMatch(/room|slot/i)
  })
})
