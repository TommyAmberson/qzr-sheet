import { describe, expect, it } from 'vitest'

import { indexOfLetter, letterOf } from '../letters'
import { PRELIM_DRAW_PATTERNS, drawPrelims, getPrelimDraw } from '../prelimDraw'

describe('PRELIM_DRAW_PATTERNS', () => {
  for (const [teamCountStr, pattern] of Object.entries(PRELIM_DRAW_PATTERNS)) {
    const teamCount = Number(teamCountStr)
    describe(`${teamCount} teams`, () => {
      it('has exactly N quizzes', () => {
        expect(pattern).toHaveLength(teamCount)
      })

      it('uses only letters A through the Nth letter', () => {
        const allowed = new Set(
          Array.from({ length: teamCount }, (_, i) => String.fromCharCode(65 + i)),
        )
        for (const triple of pattern) {
          for (const letter of triple) {
            expect(allowed.has(letter), `unexpected letter ${letter}`).toBe(true)
          }
        }
      })

      it('has 3 unique letters per quiz', () => {
        for (const triple of pattern) {
          expect(triple).toHaveLength(3)
          expect(new Set(triple).size).toBe(3)
        }
      })

      it('has every letter appearing in exactly 3 quizzes', () => {
        const counts: Record<string, number> = {}
        for (const triple of pattern) {
          for (const letter of triple) {
            counts[letter] = (counts[letter] ?? 0) + 1
          }
        }
        for (let i = 0; i < teamCount; i++) {
          const letter = String.fromCharCode(65 + i)
          expect(counts[letter], `${letter} appears ${counts[letter]}× (need 3)`).toBe(3)
        }
      })
    })
  }

  it('covers every team count from 4 to 21', () => {
    for (let n = 4; n <= 21; n++) {
      expect(PRELIM_DRAW_PATTERNS[n], `missing pattern for ${n} teams`).toBeDefined()
    }
  })
})

describe('getPrelimDraw', () => {
  it('returns the table entry for supported counts', () => {
    expect(getPrelimDraw(8)).toBe(PRELIM_DRAW_PATTERNS[8])
  })

  it('returns null for counts outside the table', () => {
    expect(getPrelimDraw(0)).toBeNull()
    expect(getPrelimDraw(3)).toBeNull()
    expect(getPrelimDraw(22)).toBeNull()
    expect(getPrelimDraw(100)).toBeNull()
  })
})

describe('drawPrelims', () => {
  const pairs = (quizzes: readonly (readonly string[])[]) => {
    const seen = new Map<string, number>()
    for (const q of quizzes) {
      const sorted = [...q].sort()
      for (let i = 0; i < 3; i++) {
        for (let j = i + 1; j < 3; j++) {
          const key = `${sorted[i]}-${sorted[j]}`
          seen.set(key, (seen.get(key) ?? 0) + 1)
        }
      }
    }
    return [...seen.values()].filter((n) => n > 1).length
  }

  for (const source of ['ruleBook', 'noRematches'] as const) {
    it(`${source}: every team plays 3 quizzes, never twice in one, for 4 to 90 teams (H-9, SC-003)`, () => {
      for (let n = 4; n <= 90; n++) {
        const quizzes = drawPrelims(n, source, 3)
        expect(quizzes, `${n} teams`).toHaveLength(n)
        const counts = new Map<string, number>()
        for (const q of quizzes) {
          expect(new Set(q).size, `${n} teams: ${q.join('')}`).toBe(3)
          for (const l of q) counts.set(l, (counts.get(l) ?? 0) + 1)
        }
        expect([...counts.keys()].sort()).toEqual(
          Array.from({ length: n }, (_, i) => letterOf(i)).sort(),
        )
        expect(
          [...counts.values()].every((c) => c === 3),
          `${n} teams`,
        ).toBe(true)
      }
    })
  }

  it('Rule book uses the tables for 4 to 21 teams', () => {
    for (let n = 4; n <= 21; n++)
      expect(drawPrelims(n, 'ruleBook', 3)).toEqual(PRELIM_DRAW_PATTERNS[n])
  })

  it('No rematches has no two teams meeting twice from 7 teams up (W-1)', () => {
    for (let n = 7; n <= 90; n++)
      expect(pairs(drawPrelims(n, 'noRematches', 3)), `${n} teams`).toBe(0)
  })

  it('the rotating draw gives quiz i the letters (i, i + k + 1, i + 2k) counted round (FR-024)', () => {
    const quizzes = drawPrelims(30, 'ruleBook', 3)
    const k = quizzes[0]!.map(indexOfLetter)[2]! / 2
    quizzes.forEach((q, i) => {
      expect(q.map(indexOfLetter)).toEqual([i, (i + k + 1) % 30, (i + 2 * k) % 30])
    })
  })

  it('letters run past Z for big divisions (H-10)', () => {
    expect(drawPrelims(32, 'ruleBook', 3).flat()).toContain('AF')
  })

  it('6 quizzes per team is two rounds, every team playing 6 (FR-025)', () => {
    for (const n of [6, 7, 12, 21]) {
      const quizzes = drawPrelims(n, 'ruleBook', 6)
      expect(quizzes).toHaveLength(2 * n)
      const counts = new Map<string, number>()
      for (const q of quizzes) for (const l of q) counts.set(l, (counts.get(l) ?? 0) + 1)
      expect(
        [...counts.values()].every((c) => c === 6),
        `${n} teams`,
      ).toBe(true)
    }
  })

  it('has nothing to draw for fewer than 4 teams', () => {
    expect(drawPrelims(3, 'ruleBook', 3)).toEqual([])
  })
})
