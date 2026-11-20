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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

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
    // Its room is linked to the meet's room 3
    doc.rooms = doc.rooms.map((room) =>
      room.id === quiz.cell!.room ? { ...room, meetRoomId: 3 } : room,
    )
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

    const details = (await getScheduledQuiz(4, quiz.id))!
    const byLetter = { A: 11, B: 10, C: 12, D: 13, E: 14, F: 15 } as Record<string, number>
    expect(details.seats.map((s) => s.team?.id)).toEqual(
      quiz.seats.map((s) => (s.kind === 'letter' ? byLetter[s.letter] : undefined)),
    )
    expect(details.seats[0]!.quizzers[0]!.name).toMatch(/Quizzer of/)
    expect(details.quiz.roomId).toBe(3)
    const { division, consolation, quizNumber } = details.quiz
    expect(
      resultName({ ...quiz, division, lane: consolation ? 1 : 0, label: `Quiz ${quizNumber}` }),
    ).toBe(resultName(quiz))
  })

  // A bench filled from results (specs/010-meet-day FR-023)
  it('fills a bench the meet has settled with the team it names by id', async () => {
    const base = newScheduleDocument('Fall Meet')
    base.settings.divisions = [
      { id: '1', name: 'Div 1', teams: 6, elims: { lanes: [], lines: [] } },
    ]
    const doc = generateSchedule(base)
    const quiz = doc.quizzes.find((q) => q.phase === 'prelim')!
    // Seated by rank, as an elimination quiz is: the draw names no team for it
    quiz.seats = [
      { kind: 'rank', rank: 1 },
      { kind: 'rank', rank: 2 },
      { kind: 'rank', rank: 3 },
    ]
    const reply = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    const read = (day: () => Promise<unknown>) =>
      vi.fn((url: string) => {
        if (url.includes('/schedule/published')) {
          return reply({ document: doc, publishedAt: '2026-11-02', view: 'teams' })
        }
        if (url.endsWith('/api/meets/4/teams')) {
          return reply({ teams: [team(20, 1), team(21, 2)], meetDivisions: ['1'] })
        }
        if (url.includes('/api/meets/4/day')) return day()
        return reply({ quizzers: [] })
      })
    const day = { phase: 'live', scheduleVersion: 1, quizzes: [], notOnSchedule: [] }
    vi.stubGlobal(
      'fetch',
      read(() =>
        reply({
          ...day,
          // The second team the roster doesn't name, so it has no id and the bench stays empty
          benches: {
            [`${quiz.id}:0`]: { team: 'Grace 2', teamId: 21 },
            [`${quiz.id}:1`]: { tied: true },
            [`${quiz.id}:2`]: { team: 'Not on the roster' },
          },
        }),
      ),
    )
    const details = (await getScheduledQuiz(4, quiz.id))!
    expect(details.seats.map((s) => s.team?.id)).toEqual([21, undefined, undefined])

    // While the API prepares the meet day it is asked again
    let preparing = true
    vi.stubGlobal(
      'fetch',
      read(() => {
        if (!preparing) {
          return reply({ ...day, benches: { [`${quiz.id}:2`]: { team: 'Grace 1', teamId: 20 } } })
        }
        preparing = false
        return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })
      }),
    )
    // The retry's one-second wait runs on fake time, so the test doesn't sleep
    vi.useFakeTimers()
    const asked = getScheduledQuiz(4, quiz.id)
    await vi.advanceTimersByTimeAsync(1000)
    const prepared = (await asked)!
    expect(prepared.seats[2]!.team?.id).toBe(20)

    // With the meet day out of reach the quiz opens as it would offline, benches empty
    vi.stubGlobal(
      'fetch',
      read(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const offline = (await getScheduledQuiz(4, quiz.id))!
    expect(offline.seats.map((s) => s.team)).toEqual([null, null, null])
    // It says so, so a refresh keeps the benches its copy already had
    expect(offline.benchesRead).toBe(false)
  })

  it('is null when the meet has no published schedule', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('/schedule/published')
          ? Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
          : Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ teams: [], meetDivisions: [] }),
            }),
      ),
    )
    expect(await getScheduledQuiz(4, 'q1')).toBeNull()
  })
})
