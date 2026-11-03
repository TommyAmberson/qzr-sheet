import { describe, expect, it } from 'vitest'
import { indexOfLetter, letterOf } from '../letters'

describe('prelim letters', () => {
  it('run A to Z, then AA, AB, … (H-10)', () => {
    expect([0, 25, 26, 27, 31, 51, 701].map(letterOf)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'AF',
      'AZ',
      'ZZ',
    ])
  })

  it('turn back into the team index', () => {
    for (let i = 0; i < 120; i++) expect(indexOfLetter(letterOf(i))).toBe(i)
  })
})
