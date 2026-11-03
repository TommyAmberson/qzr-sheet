import { describe, expect, it } from 'vitest'
import { checkSchedule } from '../conflicts'
import { buildElimQuizzes, defaultAbove, defaultElims } from '../elims'
import { generateSchedule, reflowSchedule } from '../reflow'
import {
  newScheduleDocument,
  type DivisionSettings,
  type LaneSettings,
  type ScheduleQuiz,
  type Seat,
} from '../scheduleFile'

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
      return '_'
  }
}

function seated(division: DivisionSettings): Record<string, string> {
  const quizzes = buildElimQuizzes(division)
  return Object.fromEntries(
    quizzes.map((q) => [q.label, q.seats.map((s) => show(s, quizzes)).join(', ')]),
  )
}

const div = (teams: number, elims = defaultElims(teams), name = 'Div 1'): DivisionSettings => ({
  id: 'd',
  name,
  teams,
  elims,
})

const lane = (size: number, over: Partial<LaneSettings> = {}): LaneSettings => ({
  size,
  format: 'bracket',
  finals: true,
  label: { kind: 'suffix' },
  lettering: 'continue',
  ...over,
})

describe('the bracket library (FR-029)', () => {
  it('10 teams: Heritage 2025, the 9-team bracket with New 10 in its bottom placing quiz', () => {
    const q = seated(div(10))
    expect(q['Div 1 Quiz X']).toBe('8, 9, 10')
    expect(q['Div 1 Quiz A']).toBe('1, 4, New 8')
    expect(q['Div 1 Quiz C']).toBe('3, 6, New 9')
    expect(q['Div 1 Quiz G']).toBe('3 of F, 2 of F, New 10')
    expect(q['Div 1 Finals']).toBe('1 of D, 1 of E, 1 of I')
  })

  it('11 teams: a play-in X on 9 to 11, its winner seeded 9, the other two in G', () => {
    const q = seated(div(11))
    expect(q['Div 1 Quiz X']).toBe('9, 10, 11')
    expect(q['Div 1 Quiz A']).toBe('1, 4, 1 of X')
    expect(q['Div 1 Quiz G']).toBe('2 of F, 2 of X, 3 of X')
    expect(checkSchedule(generated([11])).filter((c) => !c.warning)).toEqual([])
  })

  it("the rule book's Brackets A to C can be chosen for a 9-team lane", () => {
    const q = seated(div(9, { lanes: [lane(9, { bracket: 'ruleA' })], lines: [] }))
    expect(q['Div 1 Quiz A']).toBe('1, 2, 3')
    expect(q['Div 1 Finals']).toBe('1 of A, 1 of D, 1 of F')
  })
})

function generated(
  counts: number[],
  elims?: (DivisionSettings['elims'] | undefined)[],
  rooms = 'auto' as number | 'auto',
) {
  const doc = newScheduleDocument('Test')
  doc.settings.rooms = rooms
  doc.settings.divisions = counts.map((teams, i) => ({
    id: `d${i + 1}`,
    name: `Div ${i + 1}`,
    teams,
    elims: elims?.[i] ?? defaultElims(teams),
  }))
  return generateSchedule(doc)
}

describe('elim settings (FR-027 to FR-034)', () => {
  it('Heritage 2025: a 5-team consolation for 14, a 9-team 3C for 21', () => {
    const fourteen = seated(div(14, defaultElims(14), 'Div 2'))
    expect(fourteen['Div 2C Quiz I']).toBe('New 10, New 12, 14')
    expect(fourteen['Div 2C Quiz J']).toBe('New 11, 13, 2 of I')
    const twentyOne = seated(div(21, defaultElims(21), 'Div 3'))
    expect(twentyOne['Div 3C Quiz L']).toBe('New 13, 18, 19')
    expect(checkSchedule(generated([10, 14, 21])).filter((c) => !c.warning)).toEqual([])
  })

  it('Nov 2021: a 10-team round-robin 2C, 3 each, its Finals on points', () => {
    const elims = {
      lanes: [lane(12), lane(10, { format: 'roundRobin', perTeam: 3 })],
      lines: defaultElims(22).lines.slice(0, 1),
    }
    const quizzes = buildElimQuizzes(div(22, elims, 'Div 2'))
    const rr = quizzes.filter((q) => q.lane === 1 && !q.deciding)
    expect(rr).toHaveLength(10)
    expect(rr.every((q) => q.seats.every((s) => s.kind === 'rank' || s.kind === 'new'))).toBe(true)
    expect(quizzes.find((q) => q.label === 'Div 2C Finals')!.seats).toEqual([
      { kind: 'points', place: 1 },
      { kind: 'points', place: 2 },
      { kind: 'points', place: 3 },
    ])
  })

  it('a round robin of 8, 2 each: 6 quizzes by rank only, no three teams meeting twice', () => {
    const elims = {
      lanes: [lane(9), lane(8, { format: 'roundRobin', perTeam: 2, finals: false })],
      lines: [{}],
    }
    const rr = buildElimQuizzes(div(17, elims)).filter((q) => q.lane === 1)
    expect(rr).toHaveLength(6)
    const triples = rr.map((q) =>
      q.seats
        .map((s) => (s.kind === 'rank' ? s.rank : 0))
        .sort()
        .join(','),
    )
    expect(new Set(triples).size).toBe(6)
    for (let rank = 10; rank <= 17; rank++) {
      expect(
        rr.filter((q) => q.seats.some((s) => s.kind === 'rank' && s.rank === rank)).length,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('CMQ 2026: WXYZ on 9 to 20, 12-team A and K, a B round robin, by settings alone (SC-001)', () => {
    const own = (name: string) => ({
      label: { kind: 'own' as const, name },
      lettering: 'restart' as const,
    })
    const a = {
      lanes: [
        lane(12, own('A')),
        lane(12, own('K')),
        lane(12, { ...own('B'), format: 'roundRobin', perTeam: 3 }),
      ],
      lines: [
        { intermediate: { quizzes: 4, kind: 'rerank' as const, above: defaultAbove(4) } },
        {},
      ],
    }
    const q = seated(div(36, a, 'A'))
    expect(q['A Quiz W']).toBe('9, 16, 17')
    expect(q['A Quiz X']).toBe('10, 15, 18')
    expect(q['A Quiz Z']).toBe('12, 13, 20')
    expect(q['K Quiz A']).toBe('New 13, New 17, 24')
    expect(q['B Finals']).toBe('1 in pts, 2 in pts, 3 in pts')
    const doc = generated([36, 14], [a, undefined], 9)
    const conflicts = checkSchedule(doc)
    expect(conflicts.filter((c) => !c.warning)).toEqual([])
    // Lanes that each restart at A would save results under one name (W-5) until renamed
    expect(conflicts.some((c) => c.rule === 'W-5')).toBe(true)
  })

  it("a play-in sends places straight into seats; the second line's intermediate doubles its letters", () => {
    const elims = {
      lanes: [lane(9), lane(5), lane(4, { format: 'roundRobin', perTeam: 1, finals: false })],
      lines: [
        { intermediate: { quizzes: 1, kind: 'playIn' as const, above: 1 } },
        { intermediate: { quizzes: 1, kind: 'rerank' as const, above: 2 } },
      ],
    }
    const q = seated(div(18, elims))
    expect(q['Div 1 Quiz X']).toBe('9, 10, 11')
    expect(q['Div 1 Quiz XX']).toBe('13, 14, 15')
    expect(q['Div 1 Quiz C']).toBe('3, 4, 1 of X')
  })

  it("slides an intermediate's window along the ranks", () => {
    const one = seated(
      div(12, {
        lanes: [lane(9), lane(3, { format: 'roundRobin', perTeam: 1, finals: false })],
        lines: [{ intermediate: { quizzes: 1, kind: 'rerank', above: 1 } }],
      }),
    )
    expect(one['Div 1 Quiz X']).toBe('9, 10, 11')
    const two = seated(
      div(12, {
        lanes: [lane(9), lane(3, { format: 'roundRobin', perTeam: 1, finals: false })],
        lines: [{ intermediate: { quizzes: 1, kind: 'rerank', above: 2 } }],
      }),
    )
    expect(two['Div 1 Quiz X']).toBe('8, 9, 10')
  })

  it('removing an intermediate regenerates the lanes, keeping pinned quizzes (story 4 scenario 3)', () => {
    let doc = generated([17])
    const pinned = doc.quizzes.find((q) => q.label === 'Div 1 Quiz B')!
    pinned.pinned = true
    const before = structuredClone(pinned)
    doc.settings.divisions[0]!.elims.lines = [{}]
    doc = reflowSchedule(doc)
    expect(doc.quizzes.find((q) => q.id === pinned.id)).toEqual(before)
    expect(doc.quizzes.some((q) => q.label === 'Div 1 Quiz X')).toBe(false)
  })

  it('a lane size with no bracket gives placeholder quizzes to fill (FR-036)', () => {
    const quizzes = buildElimQuizzes(div(13, { lanes: [lane(13)], lines: [] }))
    expect(quizzes.length).toBeGreaterThan(0)
    expect(quizzes.every((q) => q.seats.every((s) => s.kind === 'empty'))).toBe(true)
  })
})
