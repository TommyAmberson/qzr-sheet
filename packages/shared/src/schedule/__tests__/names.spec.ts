import { describe, expect, it } from 'vitest'
import {
  bareDivision,
  divisionName,
  divisionTitle,
  findDivision,
  quizLabel,
  quizNumber,
  sameDivision,
} from '../names'

describe('bareDivision', () => {
  it('drops a prefix typed before the division', () => {
    for (const typed of [
      '2',
      'Div 2',
      'div  2',
      'Div. 2',
      'Division 2',
      'D2',
      'd 2',
      ' Div2 ',
      'Div-2',
      'Div: 2',
      'D-2',
    ]) {
      expect(bareDivision(typed)).toBe('2')
    }
    expect(bareDivision('Div 2C')).toBe('2C')
    expect(bareDivision('Division Junior')).toBe('Junior')
    expect(bareDivision('Div D1')).toBe('D1')
  })

  it('keeps a name that only starts like a prefix', () => {
    expect(bareDivision('Dover')).toBe('Dover')
    expect(bareDivision('Diverse')).toBe('Diverse')
    expect(bareDivision('Junior')).toBe('Junior')
    expect(bareDivision('Div')).toBe('Div')
    expect(bareDivision('')).toBe('')
  })
})

describe('divisionName', () => {
  it('names a division as the scoresheet does, showing a prefix saved by mistake', () => {
    expect(divisionName('2')).toBe('Div 2')
    expect(divisionName('2C')).toBe('Div 2C')
    expect(divisionName('Div 1')).toBe('Div Div 1')
  })
})

describe('divisionTitle', () => {
  it('shows a division on its own with its prefix', () => {
    expect(divisionTitle('1')).toBe('Division 1')
    expect(divisionTitle('Junior')).toBe('Division Junior')
  })
})

describe('sameDivision', () => {
  it('ignores case and spacing, not a prefix saved by mistake', () => {
    expect(sameDivision(' 2c', '2C')).toBe(true)
    expect(sameDivision('div  2', 'Div 2')).toBe(true)
    expect(sameDivision('2', 'Div 2')).toBe(false)
    expect(sameDivision('2', '3')).toBe(false)
  })
})

describe('findDivision', () => {
  it('finds a name in a list as the list spells it, or nothing', () => {
    expect(findDivision(['1', '2C'], '2c')).toBe('2C')
    expect(findDivision(['1', '2C'], 'Div 1')).toBeUndefined()
  })
})

describe('quizLabel', () => {
  it("labels a quiz from its division's bare name, and quizNumber reads its own name back", () => {
    expect(quizLabel('2C', 'A')).toBe('Div 2C Quiz A')
    expect(quizNumber({ label: quizLabel('1', 7) })).toBe('7')
  })
})
