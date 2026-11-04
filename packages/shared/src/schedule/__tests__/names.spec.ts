import { describe, expect, it } from 'vitest'
import { divisionName } from '../names'

describe('divisionName', () => {
  it('names a meet division as the scoresheet does, without doubling a "Div" already there', () => {
    expect(divisionName('2')).toBe('Div 2')
    expect(divisionName('2C')).toBe('Div 2C')
    expect(divisionName('Div 1')).toBe('Div 1')
    expect(divisionName('div 3')).toBe('div 3')
    expect(divisionName('Diverse')).toBe('Div Diverse')
  })
})
