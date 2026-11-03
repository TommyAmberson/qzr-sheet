import { describe, expect, it } from 'vitest'
import { BRACKET_LIBRARY } from '../bracketLibrary'
import { buildElimQuizzes, defaultElims } from '../elims'
import type { DivisionSettings, ScheduleQuiz, Seat } from '../scheduleFile'

function division(teams: number, name = 'Div 2'): DivisionSettings {
  return { id: 'd2', name, teams, elims: defaultElims(teams) }
}

/** A seat the short way: `3`, `New 7`, `2 of A`, `_` */
function show(seat: Seat, quizzes: ScheduleQuiz[]): string {
  switch (seat.kind) {
    case 'rank':
      return String(seat.rank)
    case 'new':
      return `New ${seat.rank}`
    case 'place':
      return `${seat.place} of ${quizzes
        .find((q) => q.id === seat.quiz)
        ?.label.split(' ')
        .pop()}`
    case 'points':
      return `${seat.place} in pts`
    default:
      return seat.kind === 'letter' ? seat.letter : '_'
  }
}

function byLabel(quizzes: ScheduleQuiz[]): Record<string, string> {
  return Object.fromEntries(
    quizzes.map((q) => [q.label, q.seats.map((s) => show(s, quizzes)).join(', ')]),
  )
}

describe('defaultElims (FR-030)', () => {
  it("gives each size the shape the org's meets used", () => {
    const shape = (n: number) => {
      const e = defaultElims(n)
      return {
        lanes: e.lanes.map((l) => `${l.size}${l.format === 'roundRobin' ? 'rr' : ''}`),
        lines: e.lines.map((l) =>
          l.intermediate ? `${'XY'.slice(0, l.intermediate.quizzes)}@${l.intermediate.above}` : '-',
        ),
      }
    }
    expect(shape(6)).toEqual({ lanes: ['6'], lines: [] })
    expect(shape(10)).toEqual({ lanes: ['10'], lines: [] })
    expect(shape(12)).toEqual({ lanes: ['12'], lines: [] })
    expect(shape(17)).toEqual({ lanes: ['9', '8'], lines: ['XY@3'] })
    expect(shape(14)).toEqual({ lanes: ['9', '5'], lines: ['XY@3'] })
    expect(shape(21)).toEqual({ lanes: ['12', '9'], lines: ['XY@3'] })
    expect(shape(22)).toEqual({ lanes: ['12', '10'], lines: ['XY@3'] })
    expect(shape(27)).toEqual({ lanes: ['12', '9', '6rr'], lines: ['XY@3', '-'] })
    expect(shape(28)).toEqual({ lanes: ['12', '12', '4rr'], lines: ['XY@3', '-'] })
    expect(shape(32)).toEqual({ lanes: ['12', '12', '8'], lines: ['XY@3', '-'] })
  })
})

describe('buildElimQuizzes', () => {
  it('FBC 2025, 17 teams: XY on 7 to 12, a snake-seeded 9-team main, an 8-team consolation continuing its letters', () => {
    const q = byLabel(buildElimQuizzes(division(17)))
    expect(q['Div 2 Quiz X']).toBe('7, 10, 12')
    expect(q['Div 2 Quiz Y']).toBe('8, 9, 11')
    expect(q['Div 2 Quiz A']).toBe('1, 6, New 7')
    expect(q['Div 2 Quiz B']).toBe('2, 5, New 8')
    expect(q['Div 2 Quiz C']).toBe('3, 4, New 9')
    expect(q['Div 2 Quiz H']).toBe('2 of D, 2 of E, 1 of G')
    expect(q['Div 2 Finals']).toBe('1 of D, 1 of E, 1 of H')
    expect(q['Div 2C Quiz I']).toBe('New 10, 13, 17')
    expect(q['Div 2C Quiz J']).toBe('New 11, 14, 16')
    expect(q['Div 2C Quiz K']).toBe('New 12, 15, 3 of I')
    expect(q['Div 2C Finals']).toBe('1 of L, 1 of M, 1 of P')
  })

  it('Heritage 2024, 32 teams: XY on 10 to 15, 12-team main and 2C, an 8-team third lane', () => {
    const quizzes = buildElimQuizzes(division(32))
    const q = byLabel(quizzes)
    expect(q['Div 2 Quiz X']).toBe('10, 13, 15')
    expect(q['Div 2 Quiz A']).toBe('1, 5, New 12')
    expect(q['Div 2 Quiz D']).toBe('4, 8, 9')
    expect(q['Div 2 Finals']).toBe('1 of E, 1 of I, 1 of K')
    expect(q['Div 2C Quiz L']).toBe('New 13, 17, 24')
    // No intermediate on the line between 2C and 2CC
    expect(quizzes.filter((x) => x.line === 1)).toEqual([])
    expect(Object.keys(q).filter((l) => l.startsWith('Div 2CC'))).toHaveLength(9)
  })

  it("a deciding quiz not called a Finals is the lane's next letter (FR-034)", () => {
    const d = division(17)
    d.elims.lanes[1]!.finals = false
    const q = byLabel(buildElimQuizzes(d))
    expect(q['Div 2C Finals']).toBeUndefined()
    expect(q['Div 2C Quiz Q']).toBe('1 of L, 1 of M, 1 of P')
  })

  it('marks one deciding quiz per lane and refers to quizzes by id', () => {
    const quizzes = buildElimQuizzes(division(17))
    expect(quizzes.filter((q) => q.deciding)).toHaveLength(2)
    const ids = new Set(quizzes.map((q) => q.id))
    for (const q of quizzes)
      for (const s of q.seats) if (s.kind === 'place') expect(ids.has(s.quiz)).toBe(true)
  })

  it('every library bracket seats each seed once and refers only to earlier quizzes', () => {
    for (const [key, entry] of Object.entries(BRACKET_LIBRARY)) {
      const names = entry.quizzes.map((q) => q.name)
      const seeds = entry.quizzes
        .flatMap((q) => q.seats)
        .filter((s) => /^\d+$/.test(s))
        .map(Number)
      const n = Number(key.replace('b', ''))
      expect(new Set(seeds).size, key).toBe(seeds.length)
      entry.quizzes.forEach((q, i) => {
        for (const s of q.seats) {
          const ref = /^\d([A-Z]+)$/.exec(s)
          if (ref) expect(names.slice(0, i), `${key} ${q.name}`).toContain(ref[1])
        }
      })
      for (const s of entry.deciding) expect(names, key).toContain(s.slice(1))
      expect(Math.max(...seeds), key).toBeLessThanOrEqual(n)
    }
  })
})
