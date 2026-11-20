import { describe, it, expect } from 'vitest'
import { benchShown } from '../meetDay'
import type { ViewerHas } from '../settings'
import { quiz, seats } from '../../schedule/__tests__/fixtures'

const has = (over: Partial<ViewerHas> = {}): ViewerHas => ({
  results: {},
  prelimStandings: null,
  rerank: null,
  quizzers: null,
  ...over,
})

describe('benchShown', () => {
  const p1 = quiz('p1')
  const a = quiz('A', { phase: 'elim', lane: 0, seats: seats('1', '1ofp1', '3') })
  const quizzes = new Map([p1, a].map((q) => [q.id, q]))
  const [rank, place] = a.seats

  it('shows a rank once the reader has the prelim order', () => {
    expect(benchShown(quizzes, a, rank!, has(), 'live')).toBe(false)
    expect(benchShown(quizzes, a, rank!, has({ prelimStandings: 'lockedIn' }), 'live')).toBe(true)
  })

  it('shows a place once the reader may see the results of the quiz it comes from', () => {
    expect(
      benchShown(quizzes, a, place!, has({ results: { elimination: 'places' } }), 'live'),
    ).toBe(false)
    expect(benchShown(quizzes, a, place!, has({ results: { prelim: 'places' } }), 'live')).toBe(
      true,
    )
  })

  it("shows a round robin's place by the round robin's stage, not the Finals' it feeds", () => {
    const finals = quiz('RF', {
      phase: 'elim',
      lane: 2,
      deciding: true,
      seats: seats('P1', 'P2', 'P3'),
    })
    const [points] = finals.seats
    const byStage = (stage: 'elimination' | 'finals') => has({ results: { [stage]: 'places' } })
    expect(benchShown(quizzes, finals, points!, byStage('elimination'), 'live')).toBe(true)
    expect(benchShown(quizzes, finals, points!, byStage('finals'), 'live')).toBe(false)
  })
})
