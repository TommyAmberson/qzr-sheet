import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { RouterView } from 'vue-router'
import {
  CellValue,
  generateSchedule,
  newScheduleDocument,
  PlacementFormula,
  type MeetDay,
  type ScheduleDocument,
} from '@qzr/shared'
import type { StoredQuiz } from '../api'

// A signed-in member, so the meet page opens
vi.mock('../composables/useAuth', () => {
  const data = { user: { id: 'u1' } }
  return {
    authClient: { getSession: async () => ({ data }) },
    useAuth: () => ({ session: ref({ data }) }),
  }
})

import router from '../router'

// The Quizzes tab (specs/010-meet-day, FR-012 to FR-016)

const meet = {
  id: 7,
  name: 'Fall Meet',
  dateFrom: '2026-11-20',
  dateTo: null,
  viewerCode: 'fall',
  divisions: ['1'],
  createdAt: '2026-01-01',
}

function published(): ScheduleDocument {
  const base = newScheduleDocument('Fall Meet')
  base.settings.divisions = [{ id: '1', name: '1', teams: 6, elims: { lanes: [], lines: [] } }]
  return generateSchedule(base)
}

function stored(id: number, quizNumber: string, overrides: Partial<StoredQuiz> = {}): StoredQuiz {
  return {
    id,
    origin: { action: 'submitted', name: 'Room 1' },
    stage: 'prelim',
    stageFrom: 'schedule',
    link: null,
    problems: [],
    accepted: false,
    revision: 1,
    action: 'submitted',
    savedAt: '2026-11-20T10:00:00.000Z',
    savedBy: { name: 'Room 1' },
    quizFile: {
      version: 2,
      quiz: {
        division: '1',
        quizNumber,
        overtime: false,
        placementFormula: PlacementFormula.Rules,
        questionTypes: [],
      },
      teams: [
        {
          id: 1,
          name: 'Grace 1',
          onTime: true,
          seatOrder: 0,
          quizzers: [{ id: 11, name: 'Ann', seatOrder: 0 }],
        },
        {
          id: 2,
          name: 'Grace 2',
          onTime: true,
          seatOrder: 1,
          quizzers: [{ id: 21, name: 'Bo', seatOrder: 0 }],
        },
      ],
      answers: [{ quizzerId: 11, columnKey: '1', value: CellValue.Correct }],
      noJumps: [],
    },
    ...overrides,
  }
}

const baseDay: MeetDay = {
  phase: 'live',
  scheduleVersion: 1,
  quizzes: [],
  benches: {},
  notOnSchedule: [],
}

function stubApi({
  schedule = null as ScheduleDocument | null,
  day = baseDay,
  sender = null as unknown,
  quizzes = [] as StoredQuiz[],
}) {
  const reply = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, statusText: '', json: () => Promise.resolve(body) })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
      if (path === '/api/meets/fall') return reply(200, { meet, officialCodes: [] })
      if (path === '/api/meets/7/results/sender') {
        return sender ? reply(200, sender) : reply(403, { error: 'No' })
      }
      if (path === '/api/meets/7/day') return reply(200, day)
      if (path === '/api/meets/7/schedule/published') {
        return schedule
          ? reply(200, { document: schedule, publishedAt: '2026-11-02', view: 'teams' })
          : reply(404, { error: 'Nothing is published yet' })
      }
      if (path === '/api/meets/7/results') return reply(200, quizzes)
      if (path === '/api/meets/7/stats/attention') return reply(200, { items: [] })
      return reply(404, { error: path })
    }),
  )
}

async function open() {
  await router.push('/fall/quizzes')
  const w = mount(RouterView, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

afterEach(() => vi.unstubAllGlobals())

describe('the Quizzes tab', () => {
  it('lists a scheduled quiz not in yet with when and where it is (FR-014)', async () => {
    const schedule = published()
    const quiz = schedule.quizzes.find((q) => q.cell)!
    const room = schedule.rooms.find((r) => r.id === quiz.cell!.room)!
    stubApi({
      schedule,
      day: { ...baseDay, quizzes: [{ id: quiz.id, status: 'notIn', teams: [] }] },
    })
    const w = await open()
    expect(w.find('.division-title').text()).toBe('Prelims')
    const row = w.find('tbody tr')
    expect(row.text()).toMatch(/Not in yet/)
    expect(row.find('.cell-when').text()).toContain(room.name)
  })

  it("gives a viewer the meet's quizzes from the day alone, with no schedule published", async () => {
    stubApi({
      day: {
        ...baseDay,
        scheduleVersion: null,
        notOnSchedule: [
          {
            name: 'D1 Q1',
            division: '1',
            stage: 'prelim',
            status: 'played',
            teams: [
              { name: 'Grace 1', place: 1 },
              { name: 'Grace 2', place: 2 },
            ],
          },
        ],
      },
    })
    const w = await open()
    expect(w.find('.division-title').text()).toBe('Prelims')
    expect(w.text()).toMatch(/1st Grace 1/)
    // A viewer manages nothing: no stage or link column, no downloads
    expect(w.find('.cell-stage').exists()).toBe(false)
    expect(w.find('.downloads').exists()).toBe(false)
  })

  it("gives an admin each stored quiz's actions beside its result", async () => {
    stubApi({
      sender: { admin: true, rooms: [] },
      quizzes: [stored(5, '1', { problems: [{ kind: 'unanswered', questions: ['15'] }] })],
      day: {
        ...baseDay,
        scheduleVersion: null,
        notOnSchedule: [
          {
            name: 'D1 Q1',
            division: '1',
            stage: 'prelim',
            status: 'attention',
            teams: [{ name: 'Grace 1' }, { name: 'Grace 2' }],
            storedId: 5,
            problems: [{ kind: 'unanswered', questions: ['15'] }],
          },
        ],
        attention: 1,
      },
    })
    const w = await open()
    const row = w.find('#quiz-5')
    expect(row.find('a').attributes('href')).toMatch(/\/fall\/results\/5$/)
    expect(row.text()).toMatch(/Question 15 has no answer/)
    expect(row.find('button').text()).toBe('Accept as scored')
    expect(row.find('.cell-stage select').exists()).toBe(true)
  })

  it('tells a viewer why there is nothing yet before the meet is under way (FR-002)', async () => {
    stubApi({ day: { ...baseDay, phase: 'registration', scheduleVersion: null } })
    const w = await open()
    expect(w.text()).toMatch(
      /Nothing to see yet: results and standings show once the meet is under way/,
    )
  })
})
