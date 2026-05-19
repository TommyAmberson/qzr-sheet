import { describe, it, expect } from 'vitest'

import { orderRowsByLateness, supportedKValues, type Row } from '../scheduleSort'
import { PRELIM_DRAW_PATTERNS } from '../prelimDraw'

describe('orderRowsByLateness', () => {
  it('returns input order when no letters are late (Populate case)', () => {
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const out = orderRowsByLateness(rows, new Set())
    expect(out).toEqual(rows)
  })

  it('20-team with {S, T} late: 0-late rows first, then 1-late, STA last', () => {
    // Per-row late counts for 20-team pattern (late = S, T):
    //   Row idx → letters → late count
    //    0 HSO → S          → 1
    //    1 TGP → T          → 1
    //    2 CJM → -          → 0
    //    3 NFQ → -          → 0
    //    4 BIR → -          → 0
    //    5 ELS → S          → 1
    //    6 KDT → T          → 1
    //    7 HCN → -          → 0
    //    8 JPB → -          → 0
    //    9 FAL → -          → 0
    //   10 DOI → -          → 0
    //   11 EQK → -          → 0
    //   12 RMG → -          → 0
    //   13 ABC → -          → 0
    //   14 DEF → -          → 0
    //   15 GHI → -          → 0
    //   16 JKL → -          → 0
    //   17 MNO → -          → 0
    //   18 PRQ → -          → 0
    //   19 STA → S, T       → 2
    //
    // Sort ascending by (lateCount, originalIdx):
    //   0-late (15 rows): CJM, NFQ, BIR, HCN, JPB, FAL, DOI, EQK,
    //                     RMG, ABC, DEF, GHI, JKL, MNO, PRQ
    //   1-late (4 rows):  HSO, TGP, ELS, KDT
    //   2-late (1 row):   STA
    const rows: Row[] = PRELIM_DRAW_PATTERNS[20]!.map((r) => [...r] as Row)
    const out = orderRowsByLateness(rows, new Set(['S', 'T']))

    expect(out.slice(0, 15)).toEqual([
      ['C', 'J', 'M'],
      ['N', 'F', 'Q'],
      ['B', 'I', 'R'],
      ['H', 'C', 'N'],
      ['J', 'P', 'B'],
      ['F', 'A', 'L'],
      ['D', 'O', 'I'],
      ['E', 'Q', 'K'],
      ['R', 'M', 'G'],
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
      ['J', 'K', 'L'],
      ['M', 'N', 'O'],
      ['P', 'R', 'Q'],
    ])
    expect(out.slice(15)).toEqual([
      ['H', 'S', 'O'],
      ['T', 'G', 'P'],
      ['E', 'L', 'S'],
      ['K', 'D', 'T'],
      ['S', 'T', 'A'],
    ])
  })

  it('15-team with many late letters: 0-late rows still reach the front', () => {
    // 15-team pattern: 5 of 15 rows are pure non-late when J,K,L,M,N,O
    // are late (BEF, EDA, CFG, HGD, IHE). Those should occupy the
    // first 5 cells of the sorted output. Validates the algorithm's
    // ability to push late teams back even when the rule-book doesn't
    // support K=2 tuple disjointness.
    const rows: Row[] = PRELIM_DRAW_PATTERNS[15]!.map((r) => [...r] as Row)
    const out = orderRowsByLateness(rows, new Set(['J', 'K', 'L', 'M', 'N', 'O']))

    expect(out.slice(0, 5)).toEqual([
      ['B', 'E', 'F'],
      ['E', 'D', 'A'],
      ['C', 'F', 'G'],
      ['H', 'G', 'D'],
      ['I', 'H', 'E'],
    ])
    // Most-late rows (3 late letters each) land at the very end.
    expect(out.slice(-2)).toEqual([
      ['M', 'J', 'N'],
      ['O', 'N', 'K'],
    ])
  })

  it('preserves rule-book order within the same late-count bucket', () => {
    const rows: Row[] = [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ]
    const out = orderRowsByLateness(rows, new Set(['A']))
    expect(out).toEqual([
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
      ['A', 'B', 'C'],
    ])
  })
})

describe('supportedKValues — rule-book K disjointness sweep', () => {
  // For each published team count, report which K values produce
  // pairwise-disjoint K-tuples. K=1 is always supported (trivially —
  // each tuple is a single row).

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
