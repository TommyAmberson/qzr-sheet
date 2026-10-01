import { describe, it, expect } from 'vitest'
import { QuizFormat, buildColumns } from '../scoresheet'
import { TWENTY_QUESTION_RULES, quizRules } from '../../scoring/quizRules'

const FIFTEEN = quizRules(QuizFormat.FifteenQuestion)

describe('buildColumns — 15-question quiz', () => {
  const cols = buildColumns(FIFTEEN)
  const byKey = new Map(cols.map((c) => [c.key, c]))

  it('has questions 1 to 10 plain, then 11 to 15 with A and B', () => {
    const plain = Array.from({ length: 10 }, (_, i) => `${i + 1}`)
    const ab = [11, 12, 13, 14, 15].flatMap((n) => [`${n}`, `${n}A`, `${n}B`])
    expect(cols.map((c) => c.key)).toEqual([...plain, ...ab])
  })

  it('has no questions past 15 without overtime', () => {
    expect(cols.some((c) => c.number > 15)).toBe(false)
  })

  it('marks A/B from 11 and error points from 12', () => {
    expect(byKey.get('10')!.isAB).toBe(false)
    for (const key of ['11', '11A', '11B']) {
      expect(byKey.get(key)!.isAB).toBe(true)
      expect(byKey.get(key)!.isErrorPoints).toBe(false)
    }
    for (const key of ['12', '12A', '12B', '15B']) {
      expect(byKey.get(key)!.isErrorPoints).toBe(true)
    }
  })

  it('numbers the first overtime round 16 to 18', () => {
    const ot = buildColumns(FIFTEEN, 1).filter((c) => c.isOvertime)
    expect(ot.map((c) => c.key)).toEqual([16, 17, 18].flatMap((n) => [`${n}`, `${n}A`, `${n}B`]))
  })
})

describe('buildColumns — 20-question quiz', () => {
  it('keeps the rulebook layout', () => {
    const cols = buildColumns(TWENTY_QUESTION_RULES, 1)
    const plain = Array.from({ length: 15 }, (_, i) => `${i + 1}`)
    const ab = [16, 17, 18, 19, 20, 21, 22, 23].flatMap((n) => [`${n}`, `${n}A`, `${n}B`])
    expect(cols.map((c) => c.key)).toEqual([...plain, ...ab])
    expect(cols.find((c) => c.key === '16')!.isErrorPoints).toBe(false)
    expect(cols.find((c) => c.key === '17')!.isErrorPoints).toBe(true)
    expect(cols.find((c) => c.key === '21')!.isOvertime).toBe(true)
  })
})
