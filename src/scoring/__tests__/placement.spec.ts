import { describe, it, expect } from 'vitest'
import { computePlacements, computePlacementPoints } from '../placement'

describe('computePlacements', () => {
  // --- Regulation incomplete ---

  it('returns null for all teams when regulation is incomplete', () => {
    const result = computePlacements([100, 80, 60], [], false)
    expect(result).toEqual([null, null, null])
  })

  // --- No overtime (no ties) ---

  it('ranks by score when no ties', () => {
    const result = computePlacements([140, 100, 120], [], true)
    expect(result).toEqual([1, 3, 2])
  })

  it('handles a 3-way distinct score', () => {
    const result = computePlacements([80, 120, 100], [], true)
    expect(result).toEqual([3, 1, 2])
  })

  // --- Regulation ties without OT completion ---

  it('places non-tied team immediately, leaves tied teams as null', () => {
    // Team 0: 140, Teams 1 & 2: 120 (tied) — no OT rounds completed yet
    const result = computePlacements([140, 120, 120], [], true)
    expect(result).toEqual([1, null, null])
  })

  it('leaves all teams null when 3-way tie with no OT rounds', () => {
    const result = computePlacements([120, 120, 120], [], true)
    expect(result).toEqual([null, null, null])
  })

  it('places non-tied team 3rd when it has lowest score', () => {
    // Team 0: 80, Teams 1 & 2: 120 (tied for 1st/2nd)
    const result = computePlacements([80, 120, 120], [], true)
    expect(result).toEqual([3, null, null])
  })

  it('places non-tied team 1st when tied teams are below', () => {
    // Team 0: 140, Teams 1 & 2: 100 (tied for 2nd/3rd)
    const result = computePlacements([140, 100, 100], [], true)
    expect(result).toEqual([1, null, null])
  })

  // --- OT round 1 breaks tie ---

  it('places all teams when OT round breaks 2-way tie', () => {
    // Regulation: Team 0: 140, Teams 1 & 2: 120 (tied)
    // After OT round 1: Team 1: 140, Team 2: 130 — tie broken
    const result = computePlacements([140, 120, 120], [[140, 140, 130]], true)
    expect(result).toEqual([1, 2, 3])
  })

  it('OT teams cannot pass non-OT team even with higher score', () => {
    // Regulation: Team 0: 140, Teams 1 & 2: 120 (tied)
    // After OT round 1: Team 1: 160, Team 2: 140 — tie broken
    // Team 1 has higher score than team 0, but still 2nd
    const result = computePlacements([140, 120, 120], [[140, 160, 140]], true)
    expect(result).toEqual([1, 2, 3])
  })

  // --- 3-way tie progressive resolution ---

  it('3-way tie: one team drops out after round 1, others continue', () => {
    // Regulation: all 120
    // After OT round 1: Team 0: 140, Team 1: 140, Team 2: 130
    // Team 2 drops out (3rd), Teams 0 & 1 still tied
    const result = computePlacements([120, 120, 120], [[140, 140, 130]], true)
    expect(result).toEqual([null, null, 3])
  })

  it('3-way tie resolved over 2 OT rounds', () => {
    // Regulation: all 120
    // After OT round 1: Team 0: 140, Team 1: 140, Team 2: 130 → Team 2 gets 3rd
    // After OT round 2: Team 0: 160, Team 1: 150 → tie broken
    const result = computePlacements(
      [120, 120, 120],
      [
        [140, 140, 130],
        [160, 150, 130],
      ],
      true,
    )
    expect(result).toEqual([1, 2, 3])
  })

  // --- Overtime disabled (ties are final) ---

  it('assigns shared placement to tied teams when overtime is disabled', () => {
    // No OT toggle — tie is final, both teams get 2nd
    const result = computePlacements([140, 120, 120], [], true, false)
    expect(result).toEqual([1, 2, 2])
  })

  it('3-way tie with OT disabled — all get 1st', () => {
    const result = computePlacements([120, 120, 120], [], true, false)
    expect(result).toEqual([1, 1, 1])
  })

  it('OT enabled with no rounds completed — tied teams still null', () => {
    const result = computePlacements([140, 120, 120], [], true, true)
    expect(result).toEqual([1, null, null])
  })

  it('leaves tied teams as null when OT round does not break tie', () => {
    // Regulation: Team 0: 140, Teams 1 & 2: 120
    // After OT round 1: Teams 1 & 2 both at 140 — still tied
    const result = computePlacements([140, 120, 120], [[140, 140, 140]], true)
    expect(result).toEqual([1, null, null])
  })

  it('OT breaks 2nd/3rd place tie — tied teams cannot pass 1st', () => {
    // Regulation: Team 0: 140, Teams 1 & 2: 100 (tied for 2nd/3rd)
    // After OT round 1: Team 1: 160, Team 2: 120 — tie broken
    // Team 1 has higher score than Team 0, but still 2nd
    const result = computePlacements([140, 100, 100], [[140, 160, 120]], true)
    expect(result).toEqual([1, 2, 3])
  })

  // --- Edge: all teams tied, all resolve at once ---

  it('3-way tie all resolved in 1 round', () => {
    // Regulation: all 120
    // After OT round 1: 160, 140, 130 — all different
    const result = computePlacements([120, 120, 120], [[160, 140, 130]], true)
    expect(result).toEqual([1, 2, 3])
  })
})

describe('computePlacementPoints', () => {
  it('returns null when placement is null', () => {
    expect(computePlacementPoints(120, null)).toBeNull()
  })

  it('1st: score/10, minimum 10', () => {
    expect(computePlacementPoints(140, 1)).toBe(14)
    expect(computePlacementPoints(100, 1)).toBe(10)
    expect(computePlacementPoints(60, 1)).toBe(10) // clamped to min
  })

  it('2nd: score/10 − 1, minimum 5', () => {
    expect(computePlacementPoints(140, 2)).toBe(13)
    expect(computePlacementPoints(60, 2)).toBe(5)
    expect(computePlacementPoints(30, 2)).toBe(5) // clamped to min
  })

  it('3rd: score/10 − 3, minimum 1', () => {
    expect(computePlacementPoints(140, 3)).toBe(11)
    expect(computePlacementPoints(40, 3)).toBe(1)
    expect(computePlacementPoints(0, 3)).toBe(1) // clamped to min
  })

  it('floors score/10 (does not round up)', () => {
    expect(computePlacementPoints(145, 1)).toBe(14)
    expect(computePlacementPoints(149, 2)).toBe(13)
  })

  it('uses regulation score (Q20), not OT total — caller responsibility', () => {
    // Same placement formula either way; this documents that callers must pass
    // the regulation score per rules §1.e.4: tie points awarded per Q20 score.
    expect(computePlacementPoints(140, 1)).toBe(14) // reg score 140
    expect(computePlacementPoints(160, 1)).toBe(16) // OT inflated score would differ
  })

  it('returns null for unknown placement values', () => {
    expect(computePlacementPoints(100, 4)).toBeNull()
  })
})
