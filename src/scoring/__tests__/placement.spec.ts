import { describe, it, expect } from 'vitest'
import { computePlacements, computePlacementPoints } from '../placement'
import { PlacementFormula } from '../../types/scoresheet'

describe('computePlacements', () => {
  // --- Regulation incomplete ---

  it('returns null for all teams when regulation is incomplete', () => {
    expect(computePlacements([100, 80, 60], [], false)).toEqual([null, null, null])
  })

  // --- No ties ---

  it('ranks by score when no ties', () => {
    expect(computePlacements([140, 100, 120], [], true)).toEqual([1, 3, 2])
  })

  it('handles a 3-way distinct score', () => {
    expect(computePlacements([80, 120, 100], [], true)).toEqual([3, 1, 2])
  })

  // --- Regulation ties, OT not yet resolved ---

  it('places non-tied team immediately, leaves tied teams null', () => {
    expect(computePlacements([140, 120, 120], [], true)).toEqual([1, null, null])
  })

  it('leaves all teams null when 3-way tie with no OT rounds', () => {
    expect(computePlacements([120, 120, 120], [], true)).toEqual([null, null, null])
  })

  it('places non-tied team 3rd when it has lowest score', () => {
    expect(computePlacements([80, 120, 120], [], true)).toEqual([3, null, null])
  })

  it('places non-tied team 1st when tied teams are below', () => {
    expect(computePlacements([140, 100, 100], [], true)).toEqual([1, null, null])
  })

  // --- OT breaks tie ---

  it('places all teams when OT round breaks 2-way tie', () => {
    expect(computePlacements([140, 120, 120], [[140, 140, 130]], true)).toEqual([1, 2, 3])
  })

  it('OT teams cannot pass non-OT team even with higher score', () => {
    expect(computePlacements([140, 120, 120], [[140, 160, 140]], true)).toEqual([1, 2, 3])
  })

  // --- 3-way tie progressive resolution ---

  it('3-way tie: one team drops out after round 1, others continue', () => {
    expect(computePlacements([120, 120, 120], [[140, 140, 130]], true)).toEqual([null, null, 3])
  })

  it('3-way tie resolved over 2 OT rounds', () => {
    expect(
      computePlacements(
        [120, 120, 120],
        [
          [140, 140, 130],
          [160, 150, 130],
        ],
        true,
      ),
    ).toEqual([1, 2, 3])
  })

  it('3-way tie all resolved in 1 round', () => {
    expect(computePlacements([120, 120, 120], [[160, 140, 130]], true)).toEqual([1, 2, 3])
  })

  it('3-way tie: team breaks ahead in round 1, other two continue', () => {
    // Team 0 scores highest in round 1, teams 1 & 2 still tied
    expect(computePlacements([80, 80, 80], [[120, 70, 70]], true)).toEqual([1, null, null])
  })

  it('3-way tie: team breaks ahead, remaining two resolved in round 2', () => {
    expect(
      computePlacements(
        [80, 80, 80],
        [
          [120, 70, 70],
          [120, 100, 80],
        ],
        true,
      ),
    ).toEqual([1, 2, 3])
  })

  it('3-way tie all resolved in 1 round with one team ahead', () => {
    // Team 0 breaks ahead, teams 1 & 2 are distinct below
    expect(computePlacements([80, 80, 80], [[120, 90, 70]], true)).toEqual([1, 2, 3])
  })

  it('3-way tie: one team drops below, one breaks ahead in round 1', () => {
    // Team 0 breaks ahead (highest), team 2 falls behind (lowest), team 1 in middle
    // All three resolved in round 1
    expect(computePlacements([80, 80, 80], [[120, 80, 60]], true)).toEqual([1, 2, 3])
  })

  it('2-way tie for 2nd with OT disabled returns 1 / 2.2 / 2.2', () => {
    expect(computePlacements([140, 120, 120], [], true, false)).toEqual([1, 2.2, 2.2])
  })

  it('3-way tie with OT disabled returns 1.3 / 1.3 / 1.3', () => {
    expect(computePlacements([120, 120, 120], [], true, false)).toEqual([1.3, 1.3, 1.3])
  })

  it('2-way tie for 1st with OT disabled returns 1.2 / 1.2 / 3', () => {
    expect(computePlacements([120, 120, 60], [], true, false)).toEqual([1.2, 1.2, 3])
  })

  it('OT enabled with no rounds completed — tied teams still null', () => {
    expect(computePlacements([140, 120, 120], [], true, true)).toEqual([1, null, null])
  })

  it('leaves tied teams null when OT round does not break tie', () => {
    expect(computePlacements([140, 120, 120], [[140, 140, 140]], true)).toEqual([1, null, null])
  })

  it('OT breaks 2nd/3rd place tie — tied teams cannot pass 1st', () => {
    expect(computePlacements([140, 100, 100], [[140, 160, 120]], true)).toEqual([1, 2, 3])
  })
})

describe('computePlacementPoints', () => {
  it('returns null when placement is null', () => {
    expect(computePlacementPoints(200, null)).toBeNull()
  })

  it('returns null for an unrecognised place key', () => {
    // @ts-expect-error intentional bad input
    expect(computePlacementPoints(200, 4)).toBeNull()
  })

  it('uses regulation score, not OT total — caller responsibility (§1.e.4)', () => {
    expect(computePlacementPoints(200, 1, PlacementFormula.Rules)).toBe(20)
    expect(computePlacementPoints(160, 1, PlacementFormula.Rules)).toBe(16)
  })

  describe('Rules formula', () => {
    const f = PlacementFormula.Rules

    it('1: max(10, score/10)', () => {
      expect(computePlacementPoints(200, 1, f)).toBe(20)
      expect(computePlacementPoints(120, 1, f)).toBe(12)
      expect(computePlacementPoints(100, 1, f)).toBe(10) // at threshold
      expect(computePlacementPoints(60, 1, f)).toBe(10) // clamped to base
    })

    it('1.2: max(10, score/10) (friendly tie — same as 1st)', () => {
      expect(computePlacementPoints(200, 1.2, f)).toBe(20)
      expect(computePlacementPoints(120, 1.2, f)).toBe(12)
      expect(computePlacementPoints(100, 1.2, f)).toBe(10) // at threshold
      expect(computePlacementPoints(60, 1.2, f)).toBe(10) // clamped to base
    })

    it('1.3: max(10, score/10) (friendly tie — same as 1st)', () => {
      expect(computePlacementPoints(200, 1.3, f)).toBe(20)
      expect(computePlacementPoints(120, 1.3, f)).toBe(12)
      expect(computePlacementPoints(100, 1.3, f)).toBe(10) // at threshold
      expect(computePlacementPoints(60, 1.3, f)).toBe(10) // clamped to base
    })

    it('2: max(5, score/10 − 1)', () => {
      expect(computePlacementPoints(200, 2, f)).toBe(19)
      expect(computePlacementPoints(120, 2, f)).toBe(11)
      expect(computePlacementPoints(60, 2, f)).toBe(5) // at threshold
      expect(computePlacementPoints(40, 2, f)).toBe(5) // clamped to base
    })

    it('2.2: max(5, score/10 − 1) (friendly tie — same as 2nd)', () => {
      expect(computePlacementPoints(200, 2.2, f)).toBe(19)
      expect(computePlacementPoints(120, 2.2, f)).toBe(11)
      expect(computePlacementPoints(60, 2.2, f)).toBe(5) // at threshold
      expect(computePlacementPoints(30, 2.2, f)).toBe(5) // clamped to base
    })

    it('3: max(1, score/10 − 2)', () => {
      expect(computePlacementPoints(200, 3, f)).toBe(18)
      expect(computePlacementPoints(120, 3, f)).toBe(10)
      expect(computePlacementPoints(30, 3, f)).toBe(1) // at threshold
      expect(computePlacementPoints(10, 3, f)).toBe(1) // clamped to base
    })
  })

  describe('Legacy formula (pre-2023)', () => {
    const f = PlacementFormula.Legacy

    it('1: base=10, threshold=80', () => {
      expect(computePlacementPoints(200, 1, f)).toBe(22)
      expect(computePlacementPoints(120, 1, f)).toBe(14)
      expect(computePlacementPoints(80, 1, f)).toBe(10) // at threshold
      expect(computePlacementPoints(60, 1, f)).toBe(10) // clamped to base
    })

    it('1.2: base=7, threshold=60', () => {
      expect(computePlacementPoints(200, 1.2, f)).toBe(21)
      expect(computePlacementPoints(120, 1.2, f)).toBe(13)
      expect(computePlacementPoints(60, 1.2, f)).toBe(7) // at threshold
      expect(computePlacementPoints(40, 1.2, f)).toBe(7) // clamped to base
    })

    it('1.3: base=5, threshold=50', () => {
      expect(computePlacementPoints(200, 1.3, f)).toBe(20)
      expect(computePlacementPoints(120, 1.3, f)).toBe(12)
      expect(computePlacementPoints(50, 1.3, f)).toBe(5) // at threshold
      expect(computePlacementPoints(30, 1.3, f)).toBe(5) // clamped to base
    })

    it('2: base=5, threshold=50', () => {
      expect(computePlacementPoints(200, 2, f)).toBe(20)
      expect(computePlacementPoints(120, 2, f)).toBe(12)
      expect(computePlacementPoints(50, 2, f)).toBe(5) // at threshold
      expect(computePlacementPoints(30, 2, f)).toBe(5) // clamped to base
    })

    it('2.2: base=3, threshold=30', () => {
      expect(computePlacementPoints(200, 2.2, f)).toBe(20)
      expect(computePlacementPoints(120, 2.2, f)).toBe(12)
      expect(computePlacementPoints(30, 2.2, f)).toBe(3) // at threshold
      expect(computePlacementPoints(10, 2.2, f)).toBe(3) // clamped to base
    })

    it('3: base=1, threshold=20', () => {
      expect(computePlacementPoints(200, 3, f)).toBe(19)
      expect(computePlacementPoints(120, 3, f)).toBe(11)
      expect(computePlacementPoints(20, 3, f)).toBe(1) // at threshold
      expect(computePlacementPoints(10, 3, f)).toBe(1) // clamped to base
    })
  })
})
