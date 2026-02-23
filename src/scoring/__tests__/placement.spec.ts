import { describe, it, expect } from 'vitest'
import { computePlacements } from '../placement'

describe('computePlacements', () => {
  it('returns null for all teams when quiz is incomplete', () => {
    const result = computePlacements([100, 80, 60], new Set(), false)
    expect(result).toEqual([null, null, null])
  })

  it('ranks by score when no overtime (simple case)', () => {
    const result = computePlacements([140, 100, 120], new Set(), true)
    expect(result).toEqual([1, 3, 2])
  })

  it('handles a 3-way distinct score', () => {
    const result = computePlacements([80, 120, 100], new Set(), true)
    expect(result).toEqual([3, 1, 2])
  })

  it('OT teams cannot pass non-OT teams even with higher score', () => {
    // Team 0: 140 (not in OT), Team 1: 160 (in OT, won), Team 2: 140 (in OT, lost)
    // Team 0 is 1st (not in OT). Teams 1 & 2 were tied, OT broke it.
    const result = computePlacements([140, 160, 140], new Set([1, 2]), true)
    expect(result).toEqual([1, 2, 3])
  })

  it('OT teams ranked among themselves by score', () => {
    // Team 0: 200 (not in OT), Team 1: 130 (in OT), Team 2: 150 (in OT)
    const result = computePlacements([200, 130, 150], new Set([1, 2]), true)
    expect(result).toEqual([1, 3, 2])
  })

  it('all three teams in OT ranked by score', () => {
    // All tied after regulation, all in OT
    const result = computePlacements([140, 160, 150], new Set([0, 1, 2]), true)
    expect(result).toEqual([3, 1, 2])
  })

  it('non-OT teams ranked among themselves by score', () => {
    // Two non-OT teams with different scores, one OT team
    // This shouldn't happen in practice (OT only for tied teams) but test robustness
    const result = computePlacements([200, 180, 150], new Set([2]), true)
    expect(result).toEqual([1, 2, 3])
  })

  it('two non-OT teams tied (no OT enabled) share placement', () => {
    // Tie with no OT — both get the same placement
    const result = computePlacements([100, 120, 120], new Set(), true)
    expect(result).toEqual([3, 1, 1])
  })
})
