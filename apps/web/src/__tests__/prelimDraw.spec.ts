import { describe, expect, it } from 'vitest'

import { PRELIM_DRAW_PATTERNS, getPrelimDraw } from '../prelimDraw'

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
