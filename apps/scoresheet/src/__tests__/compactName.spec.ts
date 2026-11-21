import { describe, expect, it } from 'vitest'
import { compactName } from '../compactName'

describe('compactName', () => {
  it("writes a first name and the last name's initial", () => {
    expect(compactName('Hannah Klassen')).toEqual({ first: 'Hannah', initial: ' K.' })
  })

  it('takes the last word for the initial, however many names come between', () => {
    expect(compactName('  Mary   Anne  de Vries ')).toEqual({ first: 'Mary', initial: ' V.' })
    expect(compactName('Eli martens')).toEqual({ first: 'Eli', initial: ' M.' })
  })

  it('keeps a name of one word whole, and an empty seat empty', () => {
    expect(compactName('Cher')).toEqual({ first: 'Cher', initial: '' })
    expect(compactName('   ')).toEqual({ first: '', initial: '' })
  })
})
