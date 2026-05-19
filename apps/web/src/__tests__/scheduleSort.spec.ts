import { describe, it, expect } from 'vitest'

import { orderRowsByLateness, supportedKValues, type Row } from '../scheduleSort'
import { PRELIM_DRAW_PATTERNS } from '../prelimDraw'

describe('orderRowsByLateness', () => {
  it('returns input order when no letters are late (Populate case)', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const out = orderRowsByLateness(rows, 3, new Set())
    expect(out).toEqual(rows)
  })

  it('sorts late-containing K-tuples to the back, preserving tuple groups', () => {
    // 20-team pattern, K=3. Late letters {S, T} (the "lateness ascends
    // to highest letters" Winkler convention).
    //
    // Tuples (rows 1-3, 4-6, …):
    //   T0 = HSO + TGP + CJM  → 2 late (S in row1, T in row2)
    //   T1 = NFQ + BIR + ELS  → 1 late (S in row6)
    //   T2 = KDT + HCN + JPB  → 1 late (T in row7)
    //   T3 = FAL + DOI + EQK  → 0
    //   T4 = RMG + ABC + DEF  → 0
    //   T5 = GHI + JKL + MNO  → 0
    //   T6 = PRQ + STA        → 1 late (S, T in row20)
    //
    // Sort ascending by (lateCount, originalIdx):
    //   T3 (0), T4 (0), T5 (0), T1 (1), T2 (1), T6 (1), T0 (2)
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const out = orderRowsByLateness(rows, 3, new Set(['S', 'T']))

    // First 9 rows should be the three non-late tuples (T3, T4, T5):
    expect(out.slice(0, 9)).toEqual([
      ['F', 'A', 'L'],
      ['D', 'O', 'I'],
      ['E', 'Q', 'K'],
      ['R', 'M', 'G'],
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
      ['J', 'K', 'L'],
      ['M', 'N', 'O'],
    ])

    // Last 3 rows should be the most-late tuple (T0 = HSO+TGP+CJM):
    expect(out.slice(-3)).toEqual([
      ['H', 'S', 'O'],
      ['T', 'G', 'P'],
      ['C', 'J', 'M'],
    ])
  })

  it('keeps rows within a tuple in their original order', () => {
    const rows: Row[] = [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
      ['J', 'K', 'L'],
    ]
    const out = orderRowsByLateness(rows, 2, new Set(['A']))
    // T0 = ABC+DEF (1 late), T1 = GHI+JKL (0 late). Sorted: T1, T0.
    expect(out).toEqual([
      ['G', 'H', 'I'],
      ['J', 'K', 'L'],
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
    ])
  })

  it('handles partial trailing tuples', () => {
    const rows: Row[] = [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
      ['J', 'K', 'L'],
      ['M', 'N', 'O'],
    ]
    // K=2 → tuples of 2 rows each, last tuple has 1 row.
    const out = orderRowsByLateness(rows, 2, new Set(['A', 'M']))
    // T0 = ABC+DEF (1 late), T1 = GHI+JKL (0), T2 = MNO (1).
    // Sort: T1 (0), T0 (1, idx 0), T2 (1, idx 2).
    expect(out).toEqual([
      ['G', 'H', 'I'],
      ['J', 'K', 'L'],
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['M', 'N', 'O'],
    ])
  })
})

describe('supportedKValues — rule-book K disjointness sweep', () => {
  // For each published team count, report which K values produce
  // pairwise-disjoint K-tuples. K=1 is always supported (trivially —
  // each tuple is a single row).
  //
  // The schedule allocator needs to know which K each team count
  // supports; when a division's allocation requires an unsupported K,
  // Populate should refuse and ask the admin to use fewer rooms.

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
    // Snapshot the full matrix so it shows up in test output and we
    // notice if any pattern's K-support changes accidentally.
    const matrix: Record<number, number[]> = {}
    for (const teamCount of Object.keys(PRELIM_DRAW_PATTERNS)
      .map(Number)
      .sort((a, b) => a - b)) {
      const rows = PRELIM_DRAW_PATTERNS[teamCount]!.map((r) => [...r] as Row)
      matrix[teamCount] = [...supportedKValues(rows)].sort((a, b) => a - b)
    }
    // Just assert each pattern supports K=1 (we already verified above)
    // and that the matrix is well-formed; the snapshot is for humans.
    for (const ks of Object.values(matrix)) {
      expect(ks).toContain(1)
    }
    // Log so test output shows the matrix when this test runs.

    console.log('K-support matrix:', matrix)
  })
})
