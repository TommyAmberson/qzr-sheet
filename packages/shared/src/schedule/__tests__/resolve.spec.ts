import { describe, it, expect } from 'vitest'
import { drawnTeam, resolveBenches, benchKey, type BenchSources, type PlacedTeam } from '../resolve'
import type { PlaceKey } from '../../types/scoresheet'
import { doc, quiz, seats } from './fixtures'

/** The ranked teams of an order, best first, none tied unless named in `tied` */
function order(names: string[], tied: string[] = []) {
  return names.map((name, i) => ({ name, rank: i + 1, tied: tied.includes(name) }))
}

function sources(over: Partial<BenchSources> = {}): BenchSources {
  return { orders: new Map(), placed: new Map(), tieBreaks: 'rulebook', ...over }
}

/** A schedule whose division's third lane (lane 2) is a round robin */
function withRobinLane(schedule: ReturnType<typeof doc>) {
  schedule.settings.divisions[0]!.elims.lanes = (['bracket', 'bracket', 'roundRobin'] as const).map(
    (format) => ({
      size: 3,
      format,
      finals: true,
      label: { kind: 'suffix' as const },
      lettering: 'continue' as const,
    }),
  )
  return schedule
}

const elim = (id: string, specs: string[], over = {}) =>
  quiz(id, { phase: 'elim', lane: 0, seats: seats(...specs), ...over })

describe('resolveBenches', () => {
  const schedule = doc({
    quizzes: [
      quiz('p1'),
      elim('A', ['1', '4', '5']),
      elim('B', ['2', '3', '6']),
      elim('F', ['1ofA', '1ofB', '2ofA'], { deciding: true }),
      elim('X', ['N1', 'N2', 'N3'], { lane: 1 }),
    ],
  })
  const prelims = order(['Cedar 1', 'Maple 1', 'Stone 1', 'Maple 2', 'North 2', 'Cedar 2'])

  it('settles nothing from a rank before the prelim order is confirmed', () => {
    expect(resolveBenches(schedule, 'd1', sources()).has(benchKey('A', 0))).toBe(false)
  })

  it('names each rank-seeded bench from the confirmed prelim order', () => {
    const settled = resolveBenches(
      schedule,
      'd1',
      sources({ orders: new Map([['d1', { prelims }]]) }),
    )
    expect(settled.get(benchKey('A', 0))).toEqual({ team: 'Cedar 1' })
    expect(settled.get(benchKey('A', 1))).toEqual({ team: 'Maple 2' })
    expect(settled.get(benchKey('B', 2))).toEqual({ team: 'Cedar 2' })
  })

  it('takes a rank the order still marks tied by its position in the order', () => {
    const tied = order(
      ['Cedar 1', 'Maple 1', 'Stone 1', 'Maple 2', 'North 2', 'Cedar 2'],
      ['North 2', 'Cedar 2'],
    )
    const settled = resolveBenches(
      schedule,
      'd1',
      sources({ orders: new Map([['d1', { prelims: tied }]]) }),
    )
    expect(settled.get(benchKey('A', 2))).toEqual({ team: 'North 2' })
    expect(settled.get(benchKey('A', 0))).toEqual({ team: 'Cedar 1' })
  })

  it('names a re-rank bench from the confirmed re-rank by the rank each team now holds', () => {
    const rerank = [
      { name: 'Stone 1', rank: 1, tied: false },
      { name: 'Cedar 1', rank: 2, tied: false },
      { name: 'Maple 1', rank: 3, tied: false },
    ]
    const settled = resolveBenches(
      schedule,
      'd1',
      sources({ orders: new Map([['d1', { rerank }]]) }),
    )
    expect(settled.get(benchKey('X', 0))).toEqual({ team: 'Stone 1' })
    expect(settled.get(benchKey('X', 2))).toEqual({ team: 'Maple 1' })
  })

  it('takes a re-rank bench behind a tie by its position, as a rank bench is', () => {
    const rerank = [
      { name: 'Stone 1', rank: 1, tied: false },
      { name: 'Cedar 1', rank: 2, tied: true },
      { name: 'Maple 1', rank: 2, tied: true },
    ]
    const settled = resolveBenches(
      schedule,
      'd1',
      sources({ orders: new Map([['d1', { rerank }]]) }),
    )
    expect(settled.get(benchKey('X', 2))).toEqual({ team: 'Maple 1' })
  })

  it('names a bench fed by a quiz once that quiz counts, and marks a shared place tied', () => {
    const placed = new Map<string, PlacedTeam[]>([
      [
        'A',
        [
          { name: 'Cedar 1', place: 1, placementPoints: 0, score: 100, errors: 0 },
          { name: 'Maple 2', place: 2, placementPoints: 0, score: 100, errors: 0 },
          { name: 'North 2', place: 3, placementPoints: 0, score: 100, errors: 0 },
        ],
      ],
      [
        'B',
        [
          { name: 'Maple 1', place: 1.2, placementPoints: 0, score: 100, errors: 0 },
          { name: 'Stone 1', place: 1.2, placementPoints: 0, score: 100, errors: 0 },
          { name: 'Cedar 2', place: 3, placementPoints: 0, score: 100, errors: 0 },
        ],
      ],
    ])
    const settled = resolveBenches(schedule, 'd1', sources({ placed }))
    expect(settled.get(benchKey('F', 0))).toEqual({ team: 'Cedar 1' })
    expect(settled.get(benchKey('F', 2))).toEqual({ team: 'Maple 2' })
    expect(settled.get(benchKey('F', 1))).toEqual({ tied: true })
  })

  it('leaves a bench fed by a quiz that does not count unsettled', () => {
    expect(resolveBenches(schedule, 'd1', sources()).has(benchKey('F', 0))).toBe(false)
  })

  it('names a round robin bench by placement points once every quiz of the lane counts', () => {
    const robin = withRobinLane(
      doc({
        quizzes: [
          elim('R1', ['1', '2', '3'], { lane: 2 }),
          // A team arriving from a play-in still plays in the round robin
          elim('R2', ['1', '2', '1ofPX'], { lane: 2 }),
          elim('RF', ['P1', 'P2', 'P3'], { lane: 2, deciding: true }),
          // Played after the round robin, from its points, so never part of it
          elim('RT', ['P3', 'P4', '_'], { lane: 2 }),
          // Played after the Finals, from its places, so never part of the round robin either
          elim('RX', ['1ofRF', '2ofRF', '_'], { lane: 2 }),
        ],
      }),
    )
    const r1: PlacedTeam[] = [
      { name: 'Cedar 1', place: 1, placementPoints: 20, score: 100, errors: 0 },
      { name: 'Maple 1', place: 2, placementPoints: 10, score: 100, errors: 0 },
      { name: 'Stone 1', place: 3, placementPoints: 0, score: 100, errors: 0 },
    ]
    const r2: PlacedTeam[] = [
      { name: 'Maple 1', place: 1, placementPoints: 20, score: 100, errors: 0 },
      { name: 'Stone 1', place: 2, placementPoints: 10, score: 100, errors: 0 },
      { name: 'Cedar 1', place: 3, placementPoints: 0, score: 100, errors: 0 },
    ]
    expect(
      resolveBenches(robin, 'd1', sources({ placed: new Map([['R1', r1]]) })).has(
        benchKey('RF', 0),
      ),
    ).toBe(false)
    const settled = resolveBenches(
      robin,
      'd1',
      sources({
        placed: new Map<string, PlacedTeam[]>([
          ['R1', r1],
          ['R2', r2],
        ]),
      }),
    )
    // A lane the settings make a bracket has no round robin
    const bracket = structuredClone(robin)
    bracket.settings.divisions[0]!.elims.lanes = [0, 1, 2].map(() => ({
      size: 3,
      format: 'bracket' as const,
      finals: true,
      label: { kind: 'suffix' as const },
      lettering: 'continue' as const,
    }))
    expect(
      resolveBenches(
        bracket,
        'd1',
        sources({
          placed: new Map([
            ['R1', r1],
            ['R2', r2],
          ]),
        }),
      ).has(benchKey('RF', 0)),
    ).toBe(false)
    // Maple 30, Cedar 20, Stone 10
    expect(settled.get(benchKey('RF', 0))).toEqual({ team: 'Maple 1' })
    expect(settled.get(benchKey('RF', 1))).toEqual({ team: 'Cedar 1' })
    expect(settled.get(benchKey('RF', 2))).toEqual({ team: 'Stone 1' })
  })

  it("leaves another division's benches to that division", () => {
    const prelims = order(['Cedar 1', 'Maple 1', 'Stone 1', 'North 1', 'South 1', 'East 1'])
    const settled = resolveBenches(
      schedule,
      'd2',
      sources({ orders: new Map([['d1', { prelims }]]) }),
    )
    expect(settled.size).toBe(0)
  })

  it("breaks a round robin's ties as the meet breaks the prelims'", () => {
    const robin = withRobinLane(
      doc({
        quizzes: [
          elim('R1', ['1', '2', '3'], { lane: 2 }),
          elim('R2', ['1', '2', '3'], { lane: 2 }),
          elim('R3', ['1', '2', '3'], { lane: 2 }),
          elim('RF', ['P1', 'P2', 'P3'], { lane: 2, deciding: true }),
        ],
      }),
    )
    const team = (
      name: string,
      place: PlaceKey,
      placementPoints: number,
      score: number,
    ): PlacedTeam => ({
      name,
      place,
      placementPoints,
      score,
      errors: 0,
    })
    // Cedar and Maple level on 40: Cedar finished above Maple twice, Maple scored more
    const placed = new Map<string, PlacedTeam[]>([
      ['R1', [team('Cedar 1', 1, 20, 100), team('Maple 1', 2, 10, 90), team('Stone 1', 3, 0, 0)]],
      ['R2', [team('Cedar 1', 1, 20, 100), team('Maple 1', 2, 10, 90), team('Stone 1', 3, 0, 0)]],
      ['R3', [team('Maple 1', 1, 20, 300), team('Stone 1', 2, 10, 0), team('Cedar 1', 3, 0, 0)]],
    ])
    const first = (tieBreaks: 'rulebook' | 'pointsThenErrors') =>
      resolveBenches(robin, 'd1', sources({ placed, tieBreaks })).get(benchKey('RF', 0))
    expect(first('rulebook')).toEqual({ team: 'Cedar 1' })
    expect(first('pointsThenErrors')).toEqual({ team: 'Maple 1' })
  })

  it("gives a bench the results fill its meet team's id, where the roster names one", () => {
    const fed = doc({
      quizzes: [
        quiz('p1', {
          seats: [
            { kind: 'rank', rank: 1 },
            { kind: 'rank', rank: 2 },
          ],
        }),
      ],
    })
    const settled = resolveBenches(
      fed,
      'd1',
      sources({
        orders: new Map([
          [
            'd1',
            {
              prelims: [
                { name: 'Cedar 1', rank: 1, tied: false },
                { name: 'Off Roster', rank: 2, tied: false },
              ],
            },
          ],
        ]),
        teamIdOf: (name) => (name === 'Cedar 1' ? 7 : undefined),
      }),
    )
    expect(settled.get(benchKey('p1', 0))).toEqual({ team: 'Cedar 1', teamId: 7 })
    expect(settled.get(benchKey('p1', 1))).toEqual({ team: 'Off Roster' })
  })

  it('names a letter bench from the draw, and never an empty bench', () => {
    const drawn = doc({ quizzes: [quiz('p1', { seats: seats('A', '_', 'B') })] })
    drawn.draw.d1 = {
      stale: false,
      teams: [
        { name: 'Cedar 1', letter: 'A', late: false, absent: false },
        { name: 'Maple 1', letter: 'B', late: false, absent: false },
      ],
    }
    const settled = resolveBenches(drawn, 'd1', sources())
    expect(settled.get(benchKey('p1', 0))).toEqual({ team: 'Cedar 1' })
    // A drawn team of the meet's goes by the roster's spelling now
    drawn.draw.d1!.teams[0]!.teamId = 7
    const renamed = resolveBenches(
      drawn,
      'd1',
      sources({ teamName: (id) => (id === 7 ? 'Cedar Hills 1' : undefined) }),
    )
    expect(renamed.get(benchKey('p1', 0))).toEqual({ team: 'Cedar Hills 1', teamId: 7 })
    // A team marked absent sits on no bench
    drawn.draw.d1!.teams[0]!.absent = true
    expect(resolveBenches(drawn, 'd1', sources()).has(benchKey('p1', 0))).toBe(false)
    expect(settled.has(benchKey('p1', 1))).toBe(false)
    expect(drawnTeam(drawn, drawn.quizzes[0]!, drawn.quizzes[0]!.seats[2]!)?.name).toBe('Maple 1')
  })
})
