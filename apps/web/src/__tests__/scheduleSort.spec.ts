import { describe, it, expect } from 'vitest'

import { placeRowsInGrid, supportedKValues, type Row } from '../scheduleSort'
import type { Cell } from '../scheduleAlloc'
import { PRELIM_DRAW_PATTERNS } from '../prelimDraw'

function cell(slotId: number, roomId: number): Cell {
  return { slotId, roomId }
}

/** Walk a placement and check that within any one slot, no letter
 *  appears in more than one row. Returns null on success, or a
 *  human-readable description of the first conflict found.
 *
 *  This is the critical "no team in two rooms at once" invariant:
 *  a team is identified by its rule-book letter, and the placement
 *  spreads rows across (slot, room) cells. If two rows in the same
 *  slot share a letter, that team would be playing in two rooms
 *  simultaneously — physically impossible. */
function findSlotConflict(
  placement: ReadonlyArray<Row | null>,
  cells: ReadonlyArray<Cell>,
): string | null {
  const bySlot = new Map<number, Map<string, number>>() // slot → letter → cell idx
  for (let i = 0; i < placement.length; i++) {
    const row = placement[i]
    if (!row) continue
    const slot = cells[i]!.slotId
    let placed = bySlot.get(slot)
    if (!placed) {
      placed = new Map()
      bySlot.set(slot, placed)
    }
    for (const letter of row) {
      const prevIdx = placed.get(letter)
      if (prevIdx !== undefined) {
        return `slot ${slot}: letter ${letter} appears in cell ${prevIdx} (${placement[prevIdx]?.join('')}) and cell ${i} (${row.join('')})`
      }
      placed.set(letter, i)
    }
  }
  return null
}

/** True iff the row contains any of the late letters. */
function isLateRow(row: Row, lateLetters: ReadonlySet<string>): boolean {
  return row.some((l) => lateLetters.has(l))
}

/** Find the highest cell index occupied by a non-late row and the
 *  lowest cell index occupied by a late row. If the placement is
 *  perfectly lateness-sorted, the non-late max < late min. */
function lateBoundary(
  placement: ReadonlyArray<Row | null>,
  lateLetters: ReadonlySet<string>,
): { lastNonLate: number; firstLate: number } {
  let lastNonLate = -1
  let firstLate = Infinity
  for (let i = 0; i < placement.length; i++) {
    const row = placement[i]
    if (!row) continue
    if (isLateRow(row, lateLetters)) {
      if (i < firstLate) firstLate = i
    } else {
      if (i > lastNonLate) lastNonLate = i
    }
  }
  return { lastNonLate, firstLate }
}

describe('placeRowsInGrid — Populate (no lateness) cases', () => {
  it('returns input order in a single-room layout', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10))
    expect(placeRowsInGrid(cells, rows, new Set())).toEqual(rows)
  })

  it('20-team K=3 layout: rule-book order placed without conflicts', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    // 3 rooms × 7 slots = 21 cells, 20 rows (1 trailing empty).
    const cells: Cell[] = []
    for (let s = 0; s < 7; s++) {
      for (let r = 0; r < 3; r++) cells.push(cell(100 + s, 10 + r))
    }
    const placement = placeRowsInGrid(cells, rows, new Set())
    expect(findSlotConflict(placement, cells)).toBeNull()
    // Last cell empty.
    expect(placement[20]).toBeNull()
  })

  it('20-team K=2 layout: rule-book order placed without conflicts', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    // 2 rooms × 10 slots = 20 cells, 20 rows.
    const cells: Cell[] = []
    for (let s = 0; s < 10; s++) {
      for (let r = 0; r < 2; r++) cells.push(cell(100 + s, 10 + r))
    }
    const placement = placeRowsInGrid(cells, rows, new Set())
    expect(findSlotConflict(placement, cells)).toBeNull()
  })

  it('K=1 layouts are trivially conflict-free for every team count', () => {
    for (const teamCount of Object.keys(PRELIM_DRAW_PATTERNS).map(Number)) {
      const rows: Row[] = PRELIM_DRAW_PATTERNS[teamCount]!.map((r) => [...r] as Row)
      const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10))
      const placement = placeRowsInGrid(cells, rows, new Set())
      expect(findSlotConflict(placement, cells)).toBeNull()
      // Every row placed.
      expect(placement.filter((p) => p !== null)).toHaveLength(rows.length)
    }
  })

  it('skips conflicting rows in a shared-slot cell when alternatives exist', () => {
    const rows: Row[] = [
      ['B', 'E', 'F'],
      ['E', 'D', 'A'],
      ['C', 'F', 'G'],
      ['H', 'G', 'D'],
      ['I', 'H', 'E'],
    ]
    const cells: Cell[] = [
      cell(100, 10),
      cell(100, 11), // slot 1 has 2 cells
      cell(101, 10),
      cell(102, 10),
      cell(103, 10),
    ]
    // Cell 1 skips EDA (share E) and CFG (share F) → places HGD.
    expect(placeRowsInGrid(cells, rows, new Set())).toEqual([
      ['B', 'E', 'F'],
      ['H', 'G', 'D'],
      ['E', 'D', 'A'],
      ['C', 'F', 'G'],
      ['I', 'H', 'E'],
    ])
  })

  it('falls back to the earliest remaining row when every option conflicts', () => {
    const rows: Row[] = [
      ['A', 'B', 'C'],
      ['A', 'D', 'E'],
      ['B', 'F', 'G'],
    ]
    const cells: Cell[] = [cell(100, 10), cell(100, 11), cell(101, 10)]
    const placement = placeRowsInGrid(cells, rows, new Set())
    expect(placement[0]).toEqual(['A', 'B', 'C'])
    expect(placement[1]).toEqual(['A', 'D', 'E']) // conflict accepted
    expect(placement[2]).toEqual(['B', 'F', 'G'])
  })
})

describe('placeRowsInGrid — lateness behaviour', () => {
  it('empty lateness set leaves order identical to no-lateness call', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[10]!.map((r) => [...r] as Row)
    const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10))
    const noLate = placeRowsInGrid(cells, rows, new Set())
    const emptyLate = placeRowsInGrid(cells, rows, new Set<string>())
    expect(emptyLate).toEqual(noLate)
  })

  it('15-team 6-late case (the user-reported failure): slot 1 has no late letters', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[15]!.map((r) => [...r] as Row)
    const lateLetters = new Set(['J', 'K', 'L', 'M', 'N', 'O'])
    // 2 rooms, 8 slots = 16 cells, 15 rows (1 trailing empty).
    const cells: Cell[] = []
    for (let s = 0; s < 8; s++) {
      cells.push(cell(100 + s, 10))
      cells.push(cell(100 + s, 11))
    }
    const placement = placeRowsInGrid(cells, rows, lateLetters)

    // Slot 1 must contain no late letters.
    const slot1 = [placement[0], placement[1]].filter((r): r is Row => r !== null)
    for (const row of slot1) {
      for (const letter of row) {
        expect(lateLetters.has(letter)).toBe(false)
      }
    }
    // And slot 1 must be disjoint.
    expect(findSlotConflict(placement.slice(0, 2), cells.slice(0, 2))).toBeNull()
  })

  it('lateness ordering: non-late rows precede late rows globally', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10)) // K=1
    const placement = placeRowsInGrid(cells, rows, new Set(['S', 'T']))
    const { lastNonLate, firstLate } = lateBoundary(placement, new Set(['S', 'T']))
    expect(lastNonLate).toBeLessThan(firstLate)
  })

  it('within each lateness bucket, rule-book order is preserved', () => {
    const rows: Row[] = [
      ['A', 'B', 'C'], // 0 late
      ['D', 'E', 'F'], // 0 late
      ['G', 'H', 'I'], // 0 late
      ['J', 'K', 'L'], // 1 late (L)
      ['M', 'N', 'O'], // 1 late (L? no — late = L only here)
    ]
    const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10))
    const placement = placeRowsInGrid(cells, rows, new Set(['L']))
    // 0-late rows in rule-book order: ABC, DEF, GHI, MNO; 1-late: JKL.
    expect(placement).toEqual([
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
      ['M', 'N', 'O'],
      ['J', 'K', 'L'],
    ])
  })

  it('all teams late: behaves like no-lateness (every row scores equally)', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[8]!.map((r) => [...r] as Row)
    const allLetters = new Set<string>()
    for (const row of rows) for (const l of row) allLetters.add(l)
    const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10))
    // Every row has all letters late → same lateCount for all rows →
    // stable sort returns input order.
    expect(placeRowsInGrid(cells, rows, allLetters)).toEqual(rows)
  })

  it('1-team-late: pushes the 3 rows containing that letter to the back', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10)) // K=1
    const placement = placeRowsInGrid(cells, rows, new Set(['A']))
    // Last 3 placements should be the rows containing A.
    const lastThree = placement.slice(-3).filter((r): r is Row => r !== null)
    for (const row of lastThree) {
      expect(row).toContain('A')
    }
    // And first 17 placements should not contain A.
    for (const row of placement.slice(0, 17)) {
      if (!row) continue
      expect(row.includes('A')).toBe(false)
    }
  })
})

describe('placeRowsInGrid — disjointness invariant (no team in two rooms at once)', () => {
  // The user's hard constraint: in any single slot, no team's letter
  // can appear in two of the placed rows. These tests pin that
  // invariant across many configurations.

  for (const teamCount of Object.keys(PRELIM_DRAW_PATTERNS)
    .map(Number)
    .sort((a, b) => a - b)) {
    it(`team count ${teamCount}, K=1: no slot conflicts (Populate)`, () => {
      const rows: Row[] = PRELIM_DRAW_PATTERNS[teamCount]!.map((r) => [...r] as Row)
      const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10))
      const placement = placeRowsInGrid(cells, rows, new Set())
      expect(findSlotConflict(placement, cells)).toBeNull()
    })

    it(`team count ${teamCount}, K=1: no slot conflicts (lateness on every other letter)`, () => {
      const rows: Row[] = PRELIM_DRAW_PATTERNS[teamCount]!.map((r) => [...r] as Row)
      const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10))
      // Mark every other letter late.
      const lateLetters = new Set<string>()
      for (let i = 0; i < teamCount; i += 2) {
        lateLetters.add(String.fromCharCode(65 + i))
      }
      const placement = placeRowsInGrid(cells, rows, lateLetters)
      expect(findSlotConflict(placement, cells)).toBeNull()
    })
  }

  it('20-team K=3, no lateness: no slot conflicts (rule-book disjointness preserved)', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const cells: Cell[] = []
    for (let s = 0; s < 7; s++) for (let r = 0; r < 3; r++) cells.push(cell(100 + s, 10 + r))
    const placement = placeRowsInGrid(cells, rows, new Set())
    expect(findSlotConflict(placement, cells)).toBeNull()
  })

  it('20-team K=2, no lateness: no slot conflicts', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const cells: Cell[] = []
    for (let s = 0; s < 10; s++) for (let r = 0; r < 2; r++) cells.push(cell(100 + s, 10 + r))
    const placement = placeRowsInGrid(cells, rows, new Set())
    expect(findSlotConflict(placement, cells)).toBeNull()
  })

  it('15-team K=2, no lateness: greedy avoids early-slot conflicts even though K=2 not natively supported', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[15]!.map((r) => [...r] as Row)
    const cells: Cell[] = []
    for (let s = 0; s < 8; s++) {
      cells.push(cell(100 + s, 10))
      cells.push(cell(100 + s, 11))
    }
    const placement = placeRowsInGrid(cells, rows, new Set())
    // Any conflict must land only at the very last slot (no earlier).
    const conflict = findSlotConflict(placement, cells)
    if (conflict !== null) {
      // The greedy may leave a tail conflict; assert that the conflict
      // is no earlier than the second-to-last slot.
      const m = conflict.match(/slot (\d+)/)
      const conflictSlot = m ? Number(m[1]) : -1
      expect(conflictSlot).toBeGreaterThanOrEqual(106)
    }
  })

  it('15-team K=2, all late: greedy still avoids conflicts where possible', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[15]!.map((r) => [...r] as Row)
    const allLetters = new Set<string>()
    for (let i = 0; i < 15; i++) allLetters.add(String.fromCharCode(65 + i))
    const cells: Cell[] = []
    for (let s = 0; s < 8; s++) {
      cells.push(cell(100 + s, 10))
      cells.push(cell(100 + s, 11))
    }
    // With every row equally late, the algorithm collapses to rule-
    // book order + greedy disjointness — same behaviour as no
    // lateness in this case.
    const placement = placeRowsInGrid(cells, rows, allLetters)
    const noLate = placeRowsInGrid(cells, rows, new Set())
    expect(placement).toEqual(noLate)
  })

  it('20-team K=3, S and T late: slot 1 has no conflicts AND no late letters', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const cells: Cell[] = []
    for (let s = 0; s < 7; s++) for (let r = 0; r < 3; r++) cells.push(cell(100 + s, 10 + r))
    const placement = placeRowsInGrid(cells, rows, new Set(['S', 'T']))
    // Slot 1 first three cells.
    const slot1 = placement.slice(0, 3).filter((r): r is Row => r !== null)
    expect(slot1).toHaveLength(3)
    const seen = new Set<string>()
    for (const row of slot1) {
      for (const letter of row) {
        expect(seen.has(letter)).toBe(false)
        expect(letter).not.toBe('S')
        expect(letter).not.toBe('T')
        seen.add(letter)
      }
    }
  })
})

describe('placeRowsInGrid — cell layout edge cases', () => {
  it('more cells than rows: trailing cells are null', () => {
    const rows: Row[] = [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
    ]
    const cells: Cell[] = [cell(100, 10), cell(101, 10), cell(102, 10), cell(103, 10)]
    const placement = placeRowsInGrid(cells, rows, new Set())
    expect(placement[0]).toEqual(['A', 'B', 'C'])
    expect(placement[1]).toEqual(['D', 'E', 'F'])
    expect(placement[2]).toBeNull()
    expect(placement[3]).toBeNull()
  })

  it('empty rows produces all-null placement', () => {
    const cells: Cell[] = [cell(100, 10), cell(101, 10)]
    const placement = placeRowsInGrid(cells, [], new Set())
    expect(placement).toEqual([null, null])
  })

  it('empty cells produces empty placement', () => {
    const rows: Row[] = [['A', 'B', 'C']]
    const placement = placeRowsInGrid([], rows, new Set())
    expect(placement).toEqual([])
  })

  it('handles varying K across slots (1 in some slots, 2 or 3 in others)', () => {
    // 20-team rows in a mixed-K layout: slot 1 has 3 cells, slot 2 has
    // 1 cell, slot 3 has 2 cells, etc.
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const cells: Cell[] = [
      cell(100, 10),
      cell(100, 11),
      cell(100, 12), // slot 1: K=3
      cell(101, 10), // slot 2: K=1
      cell(102, 10),
      cell(102, 11), // slot 3: K=2
      cell(103, 10),
      cell(103, 11),
      cell(103, 12), // slot 4: K=3
      cell(104, 10), // slot 5: K=1
      cell(105, 10),
      cell(105, 11), // slot 6: K=2
      cell(106, 10),
      cell(106, 11),
      cell(106, 12), // slot 7: K=3
      cell(107, 10), // slot 8: K=1
      cell(108, 10),
      cell(108, 11), // slot 9: K=2
      cell(109, 10),
      cell(109, 11), // slot 10: K=2
    ]
    expect(cells).toHaveLength(20)
    const placement = placeRowsInGrid(cells, rows, new Set())
    expect(findSlotConflict(placement, cells)).toBeNull()
  })
})

describe('placeRowsInGrid — determinism', () => {
  it('same input produces same output', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[12]!.map((r) => [...r] as Row)
    const cells: Cell[] = []
    for (let s = 0; s < 6; s++) {
      cells.push(cell(100 + s, 10))
      cells.push(cell(100 + s, 11))
    }
    const a = placeRowsInGrid(cells, rows, new Set(['A', 'L']))
    const b = placeRowsInGrid(cells, rows, new Set(['A', 'L']))
    expect(a).toEqual(b)
  })
})

describe('supportedKValues — rule-book K disjointness sweep', () => {
  for (const teamCount of Object.keys(PRELIM_DRAW_PATTERNS)
    .map(Number)
    .sort((a, b) => a - b)) {
    it(`${teamCount} teams — at minimum K=1 works`, () => {
      const rows = PRELIM_DRAW_PATTERNS[teamCount]!.map((r) => [...r] as Row)
      expect(supportedKValues(rows).has(1)).toBe(true)
    })
  }

  it('20-team pattern supports K=2 and K=3 (the realistic large-meet config)', () => {
    const rows = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const supported = supportedKValues(rows)
    expect(supported.has(2)).toBe(true)
    expect(supported.has(3)).toBe(true)
  })

  it('reports the support matrix for documentation / future use', () => {
    const matrix: Record<number, number[]> = {}
    for (const teamCount of Object.keys(PRELIM_DRAW_PATTERNS)
      .map(Number)
      .sort((a, b) => a - b)) {
      const rows = PRELIM_DRAW_PATTERNS[teamCount]!.map((r) => [...r] as Row)
      matrix[teamCount] = [...supportedKValues(rows)].sort((a, b) => a - b)
    }
    for (const ks of Object.values(matrix)) {
      expect(ks).toContain(1)
    }
     
    console.log('K-support matrix:', matrix)
  })
})
