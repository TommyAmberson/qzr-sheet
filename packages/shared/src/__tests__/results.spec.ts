import { describe, it, expect } from 'vitest'
import { editDistance } from '../results'

describe('editDistance', () => {
  it('counts the insertions, deletions and substitutions between two strings', () => {
    expect(editDistance('calgary 1', 'calgary 1')).toBe(0)
    expect(editDistance('calgary 1', 'calgry 1')).toBe(1)
    expect(editDistance('calgary 1', 'calgray 1')).toBe(2)
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('abc', '')).toBe(3)
  })
})
