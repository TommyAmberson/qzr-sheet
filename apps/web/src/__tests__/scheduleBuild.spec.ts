import { describe, it, expect } from 'vitest'

import { buildElimPlan } from '../scheduleBuild'

describe('buildElimPlan — letter labels and placeholder seats', () => {
  it('labels elim quizzes with letters (QA, QB, QC, ...)', () => {
    const cells = [
      { slotId: 100, roomId: 10 },
      { slotId: 100, roomId: 11 },
      { slotId: 101, roomId: 10 },
    ]
    const plan = buildElimPlan('1', cells)
    expect(plan.map((d) => d.label)).toEqual(['D1-QA', 'D1-QB', 'D1-QC'])
  })

  it('uses placeholder A/B/C seats (resolved later by seed refs)', () => {
    const plan = buildElimPlan('1', [{ slotId: 100, roomId: 10 }])
    expect(plan[0]!.seats).toEqual([
      { seatNumber: 1, letter: 'A' },
      { seatNumber: 2, letter: 'B' },
      { seatNumber: 3, letter: 'C' },
    ])
  })

  it('returns empty plan for empty cells list', () => {
    expect(buildElimPlan('1', [])).toEqual([])
  })

  it('phase is "elim"', () => {
    const plan = buildElimPlan('1', [{ slotId: 100, roomId: 10 }])
    expect(plan[0]!.phase).toBe('elim')
  })

  it('preserves cell slotId and roomId on each quiz', () => {
    const plan = buildElimPlan('Div', [{ slotId: 42, roomId: 99 }])
    expect(plan[0]!.slotId).toBe(42)
    expect(plan[0]!.roomId).toBe(99)
    expect(plan[0]!.division).toBe('Div')
    expect(plan[0]!.label).toBe('DDiv-QA')
  })
})
