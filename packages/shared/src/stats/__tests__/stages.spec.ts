import { describe, it, expect } from 'vitest'
import { scheduledStage, storedStage } from '../stages'

describe('scheduledStage', () => {
  it('takes a prelim, an intermediate, an elimination and a Finals from the schedule', () => {
    expect(scheduledStage({ phase: 'prelim' })).toBe('prelim')
    // An elimination quiz on a line is that line's intermediate
    expect(scheduledStage({ phase: 'elim', line: 0 })).toBe('intermediate')
    expect(scheduledStage({ phase: 'elim' })).toBe('elimination')
    // A bracket's deciding quiz is its Finals
    expect(scheduledStage({ phase: 'elim', deciding: true })).toBe('finals')
  })
})

describe('storedStage', () => {
  const elim = { phase: 'elim' } as const

  it("follows the admin's choice before anything else", () => {
    expect(storedStage({ chosen: 'finals', linked: elim, counted: true })).toEqual({
      stage: 'finals',
      from: 'admin',
    })
    expect(storedStage({ chosen: 'notCounted', linked: elim, counted: true })).toEqual({
      stage: null,
      from: 'admin',
    })
  })

  it('else takes the stage of the scheduled quiz it is linked to', () => {
    expect(storedStage({ chosen: null, linked: elim, counted: false })).toEqual({
      stage: 'elimination',
      from: 'schedule',
    })
  })

  it('else makes a quiz counted before stages a prelim, and any other nothing', () => {
    expect(storedStage({ chosen: null, linked: null, counted: true })).toEqual({
      stage: 'prelim',
      from: 'counted',
    })
    expect(storedStage({ chosen: null, linked: null, counted: false })).toEqual({
      stage: null,
      from: null,
    })
  })
})
