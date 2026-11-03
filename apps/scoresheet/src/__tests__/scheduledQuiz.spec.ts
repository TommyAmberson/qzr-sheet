import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSchedule, newScheduleDocument, resultName } from '@qzr/shared'

import { getScheduledQuiz } from '../api'

const team = (id: number, number: number) => ({
  id,
  churchId: 1,
  churchName: 'Grace Church',
  churchShortName: 'Grace',
  division: '1',
  number,
  consolation: false,
})

afterEach(() => vi.unstubAllGlobals())

describe('getScheduledQuiz (research R10)', () => {
  it("resolves a quiz's letters to the drawn teams, with the fields that name its results", async () => {
    const base = newScheduleDocument('Fall Meet')
    base.settings.divisions = [
      { id: '1', name: 'Div 1', teams: 6, elims: { lanes: [], lines: [] } },
    ]
    const doc = generateSchedule(base)
    doc.draw['1'] = {
      stale: false,
      teams: [
        { teamId: 10, letter: 'B', late: false, absent: false },
        { teamId: 11, letter: 'A', late: false, absent: false },
        { teamId: 12, letter: 'C', late: false, absent: false },
        { teamId: 13, letter: 'D', late: false, absent: false },
        { teamId: 14, letter: 'E', late: false, absent: false },
        { teamId: 15, letter: 'F', late: false, absent: false },
      ],
    }
    const quiz = doc.quizzes.find((q) => q.phase === 'prelim')!
    const reply = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/schedule/published')) {
          return reply({ document: doc, publishedAt: '2026-11-02', view: 'teams' })
        }
        if (url.endsWith('/api/meets/4/teams')) {
          return reply({
            teams: [10, 11, 12, 13, 14, 15].map((id, i) => team(id, i + 1)),
            meetDivisions: ['1'],
          })
        }
        const roster = /\/api\/teams\/(\d+)\/quizzers$/.exec(url)
        if (roster) return reply({ quizzers: [{ id: 1, name: `Quizzer of ${roster[1]}` }] })
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
      }),
    )

    const details = await getScheduledQuiz(4, quiz.id)
    const byLetter = { A: 11, B: 10, C: 12, D: 13, E: 14, F: 15 } as Record<string, number>
    expect(details.seats.map((s) => s.team?.id)).toEqual(
      quiz.seats.map((s) => (s.kind === 'letter' ? byLetter[s.letter] : undefined)),
    )
    expect(details.seats[0]!.quizzers[0]!.name).toMatch(/Quizzer of/)
    const { division, consolation, quizNumber } = details.quiz
    expect(
      resultName({ ...quiz, division, lane: consolation ? 1 : 0, label: `Quiz ${quizNumber}` }),
    ).toBe(resultName(quiz))
  })
})
