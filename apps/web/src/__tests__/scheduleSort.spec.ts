import { describe, it, expect } from 'vitest'

import { countLate, supportedKValues, type Row } from '../scheduleSort'
import { PRELIM_DRAW_PATTERNS } from '../prelimDraw'

describe('countLate', () => {
  it('returns 0 when the lateness set is empty', () => {
    expect(countLate(['A', 'B', 'C'], new Set())).toBe(0)
  })

  it('counts how many of the row letters are in the lateness set', () => {
    expect(countLate(['A', 'B', 'C'], new Set(['A']))).toBe(1)
    expect(countLate(['A', 'B', 'C'], new Set(['A', 'B']))).toBe(2)
    expect(countLate(['A', 'B', 'C'], new Set(['A', 'B', 'C']))).toBe(3)
    expect(countLate(['A', 'B', 'C'], new Set(['D']))).toBe(0)
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
