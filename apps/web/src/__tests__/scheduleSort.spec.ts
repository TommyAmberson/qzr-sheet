import { describe, it, expect } from 'vitest'

import { placeRowsInGrid, supportedKValues, type Row } from '../scheduleSort'
import type { Cell } from '../scheduleAlloc'
import { PRELIM_DRAW_PATTERNS } from '../prelimDraw'

function cell(slotId: number, roomId: number): Cell {
  return { slotId, roomId }
}

describe('placeRowsInGrid', () => {
  it('returns input order in a one-row-per-cell layout (Populate, no lateness)', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    // Single-room layout: 20 cells in 20 slots, no within-slot
    // conflicts possible.
    const cells: Cell[] = rows.map((_, i) => cell(100 + i, 10))
    const placement = placeRowsInGrid(cells, rows, new Set())
    expect(placement).toEqual(rows)
  })

  it('skips conflicting rows for the same slot when alternatives exist', () => {
    // Two cells at the same slot. With BEF first, EDA next: EDA shares
    // E with BEF, so EDA is skipped in favour of CFG. Wait — CFG also
    // shares F. So HGD (disjoint) wins.
    const rows: Row[] = [
      ['B', 'E', 'F'],
      ['E', 'D', 'A'],
      ['C', 'F', 'G'],
      ['H', 'G', 'D'],
      ['I', 'H', 'E'],
    ]
    // Slot 1 has 2 cells; cells 3..5 are one-per-slot.
    const cells: Cell[] = [
      cell(100, 10),
      cell(100, 11),
      cell(101, 10),
      cell(102, 10),
      cell(103, 10),
    ]
    const placement = placeRowsInGrid(cells, rows, new Set())
    // Cell 0: BEF (first, alone). Cell 1: try EDA (share E ✗) → CFG
    // (share F ✗) → HGD (disjoint ✓). Cells 2..4 pick up the skipped
    // EDA, CFG and the trailing IHE in order.
    expect(placement).toEqual([
      ['B', 'E', 'F'],
      ['H', 'G', 'D'],
      ['E', 'D', 'A'],
      ['C', 'F', 'G'],
      ['I', 'H', 'E'],
    ])
  })

  it('with late letters: non-late rows fill early cells, late rows pile at back', () => {
    // 15-team pattern, late = J,K,L,M,N,O (the 6 highest letters when
    // 6 of 15 teams are marked late). 5 of the 15 rows are pure non-
    // late (BEF, EDA, CFG, HGD, IHE). The first 5 cells should get
    // those — slot 1 with BEF + HGD avoids the BEF/EDA E-conflict.
    const rows: Row[] = PRELIM_DRAW_PATTERNS[15]!.map((r) => [...r] as Row)
    // 2 D2 rooms × 8 slots = 16 cells, slot 1 has 2 cells (the test
    // shape that the user complained about).
    const cells: Cell[] = []
    for (let s = 0; s < 8; s++) {
      cells.push(cell(100 + s, 10))
      cells.push(cell(100 + s, 11))
    }
    // 15 rows in 16 cells → 1 trailing empty.
    const placement = placeRowsInGrid(cells, rows, new Set(['J', 'K', 'L', 'M', 'N', 'O']))

    // Slot 1 should have two non-late, disjoint rows.
    expect(placement[0]).toEqual(['B', 'E', 'F'])
    expect(placement[1]).toEqual(['H', 'G', 'D'])
    // No late letters appear in slot 1.
    const slot1Letters = new Set([...placement[0]!, ...placement[1]!])
    for (const late of ['J', 'K', 'L', 'M', 'N', 'O']) {
      expect(slot1Letters.has(late)).toBe(false)
    }
    // Last cell is empty (rows < cells).
    expect(placement[15]).toBeNull()
  })

  it('preserves rule-book order within the same late-count bucket', () => {
    const rows: Row[] = [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ]
    // 3 cells in 3 separate slots (no disjointness pressure).
    const cells: Cell[] = [cell(100, 10), cell(101, 10), cell(102, 10)]
    const placement = placeRowsInGrid(cells, rows, new Set(['A']))
    // Sorted: DEF (0), GHI (0), ABC (1).
    expect(placement).toEqual([
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
      ['A', 'B', 'C'],
    ])
  })

  it('falls back to the earliest remaining row when every option conflicts', () => {
    // Slot 1 has two cells. Three rows all share letters with each
    // other; the first cell takes the first row, the second cell can't
    // find a non-conflicting row so it accepts the conflict.
    const rows: Row[] = [
      ['A', 'B', 'C'],
      ['A', 'D', 'E'],
      ['B', 'F', 'G'],
    ]
    const cells: Cell[] = [cell(100, 10), cell(100, 11), cell(101, 10)]
    const placement = placeRowsInGrid(cells, rows, new Set())
    expect(placement[0]).toEqual(['A', 'B', 'C'])
    // Cell 1: neither remaining row is disjoint with ABC (both share
    // A or B). Take the earliest (ADE), conflict accepted.
    expect(placement[1]).toEqual(['A', 'D', 'E'])
    expect(placement[2]).toEqual(['B', 'F', 'G'])
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
