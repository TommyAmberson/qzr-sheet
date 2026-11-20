import { describe, it, expect } from 'vitest'
import { editDistance, quizFileStem } from '../results'

describe('quizFileStem', () => {
  it('names a file by its quiz, with "_" for a blank part', () => {
    expect(quizFileStem({ division: '1', quizNumber: '3' })).toBe('D1Q3')
    expect(quizFileStem({ division: '2', consolation: true, quizNumber: 'b' })).toBe('D2cQb')
    expect(quizFileStem({ division: ' ', quizNumber: '_' })).toBe('D_Q_')
    expect(quizFileStem({ division: 'Jr/Sr', quizNumber: '1' })).toBe('DJr-SrQ1')
    expect(quizFileStem({ division: 'Jr: A', quizNumber: '3?' })).toBe('DJr- AQ3-')
  })
})

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
