import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { generateSchedule, newScheduleDocument, type ScheduleDocument } from '@qzr/shared'

import { RouterView } from 'vue-router'

// A signed-in member, so the meet page opens
vi.mock('../composables/useAuth', () => {
  const data = { user: { id: 'u1' } }
  return {
    authClient: { getSession: async () => ({ data }) },
    useAuth: () => ({ session: ref({ data }) }),
  }
})

import router from '../router'

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
  const doc = generateSchedule(base)
  doc.draw['1'] = {
    stale: false,
    teams: 'ABCDEF'.split('').map((letter, i) => ({
      letter,
      name: `Grace ${i + 1}`,
      late: false,
      absent: false,
    })),
  }
  return doc
}

function stubApi(
  answer: { status: number; body: unknown },
  { sender = null as unknown, day: dayBody = day as unknown } = {},
) {
  const reply = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, statusText: '', json: () => Promise.resolve(body) })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
      if (path === '/api/meets/fall') return reply(200, { meet, officialCodes: [] })
      if (path === '/api/my-meets') return reply(200, { memberships: [] })
      if (path === '/api/meets/7/results/sender') {
        return sender ? reply(200, sender) : reply(403, { error: 'No' })
      }
      if (path === '/api/meets/7/day') return reply(200, dayBody)
      if (path === '/api/meets/7/schedule/published') return reply(answer.status, answer.body)
      return reply(404, { error: path })
    }),
  )
}

const day = { phase: 'live', scheduleVersion: 1, quizzes: [], benches: {}, notOnSchedule: [] }

/** The meet page on its Schedule tab, as a signed-in member opens it */
async function open(path = '/fall') {
  await router.push(path)
  const w = mount(RouterView, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

afterEach(() => vi.unstubAllGlobals())

describe('the Schedule tab (FR-008; FR-050, FR-052 of schedules)', () => {
  it('shows the published schedule in the view the API gives, quizzes linking to the scoresheet for an admin', async () => {
    const doc = published()
    stubApi(
      { status: 200, body: { document: doc, publishedAt: '2026-11-02', view: 'teams' } },
      { sender: { admin: true, rooms: [] } },
    )
    const w = await open()
    expect(w.text()).toMatch(/Grace 1/)
    const quiz = doc.quizzes.find((q) => q.cell)!
    const link = w.find(`[data-quiz="${quiz.id}"] a.quiz-title`)
    expect(link.attributes('href')).toMatch(
      new RegExp(`\\?meetId=7&quiz=${encodeURIComponent(quiz.id)}$`),
    )
  })

  it("shows a viewer each quiz's result and opens nothing they may not read", async () => {
    const doc = published()
    const quiz = doc.quizzes.find((q) => q.cell)!
    stubApi(
      { status: 200, body: { document: doc, publishedAt: '2026-11-02', view: 'teams' } },
      {
        day: {
          ...day,
          quizzes: [{ id: quiz.id, status: 'played', teams: [{ name: 'Grace 1', place: 1 }] }],
        },
      },
    )
    const w = await open()
    const cell = w.find(`[data-quiz="${quiz.id}"]`)
    expect(cell.find('a').exists()).toBe(false)
    expect(cell.text()).toMatch(/1st/)
  })

  it("opens an admin's stored quiz at its page", async () => {
    const doc = published()
    const quiz = doc.quizzes.find((q) => q.cell)!
    stubApi(
      { status: 200, body: { document: doc, publishedAt: '2026-11-02', view: 'teams' } },
      {
        sender: { admin: true, rooms: [] },
        day: { ...day, quizzes: [{ id: quiz.id, status: 'played', teams: [], storedId: 42 }] },
      },
    )
    const w = await open()
    expect(w.find(`[data-quiz="${quiz.id}"] a.quiz-title`).attributes('href')).toMatch(
      /\/fall\/results\/42$/,
    )
  })

  it('shows only the picked division', async () => {
    const doc = published()
    doc.settings.divisions.push({ id: '2', name: '2', teams: 0, elims: { lanes: [], lines: [] } })
    const other = doc.quizzes.find((q) => q.cell)!
    other.division = '2'
    stubApi({ status: 200, body: { document: doc, publishedAt: '2026-11-02', view: 'teams' } })
    const w = await open('/fall?division=1')
    expect(w.find(`[data-quiz="${other.id}"]`).exists()).toBe(false)
    expect(w.findAll('[data-quiz]').length).toBe(doc.quizzes.filter((q) => q.cell).length - 1)
  })

  it('shows letters when the API says so', async () => {
    const doc = published()
    stubApi({ status: 200, body: { document: doc, publishedAt: '2026-11-02', view: 'letters' } })
    const w = await open()
    expect(w.text()).not.toMatch(/Grace 1/)
  })

  it('says so when nothing is published', async () => {
    stubApi({ status: 404, body: { error: 'Nothing is published yet' } })
    const w = await open()
    expect(w.text()).toMatch(/hasn't been published yet/)
  })
})
