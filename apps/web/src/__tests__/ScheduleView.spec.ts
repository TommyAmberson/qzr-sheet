import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { generateSchedule, newScheduleDocument, type ScheduleDocument } from '@qzr/shared'

import router from '../router'
import ScheduleView from '../views/ScheduleView.vue'

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
  base.settings.divisions = [{ id: '1', name: 'Div 1', teams: 6, elims: { lanes: [], lines: [] } }]
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

function stubApi(answer: { status: number; body: unknown }) {
  const reply = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, statusText: '', json: () => Promise.resolve(body) })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
      if (path === '/api/meets/fall') return reply(200, { meet, officialCodes: [] })
      if (path === '/api/my-meets') return reply(200, { memberships: [] })
      if (path === '/api/meets/7/schedule/published') return reply(answer.status, answer.body)
      return reply(404, { error: path })
    }),
  )
}

async function open() {
  const w = mount(ScheduleView, { props: { slug: 'fall' }, global: { plugins: [router] } })
  await flushPromises()
  return w
}

afterEach(() => vi.unstubAllGlobals())

describe('the portal schedule (FR-050, FR-052)', () => {
  it('shows the published schedule in the view the API gives, quizzes linking to the scoresheet', async () => {
    const doc = published()
    stubApi({ status: 200, body: { document: doc, publishedAt: '2026-11-02', view: 'teams' } })
    const w = await open()
    expect(w.text()).toMatch(/Grace 1/)
    const quiz = doc.quizzes.find((q) => q.cell)!
    const link = w.find(`[data-quiz="${quiz.id}"] a.quiz-title`)
    expect(link.attributes('href')).toMatch(
      new RegExp(`\\?meetId=7&quiz=${encodeURIComponent(quiz.id)}$`),
    )
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
