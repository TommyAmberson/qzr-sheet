import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { RouterView } from 'vue-router'
import { generateSchedule, newScheduleDocument, type ScheduleDocument } from '@qzr/shared'

// The Schedule tab at phone width (specs/010-meet-day FR-021)

vi.mock('../viewport', () => ({ phone: true }))
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
  divisions: ['1', '2'],
  createdAt: '2026-01-01',
}

function published(): ScheduleDocument {
  const base = newScheduleDocument('Fall Meet')
  base.settings.divisions = [
    { id: '1', name: '1', teams: 6, elims: { lanes: [], lines: [] } },
    { id: '2', name: '2', teams: 6, elims: { lanes: [], lines: [] } },
  ]
  return generateSchedule(base)
}

function stubApi(schedule: ScheduleDocument) {
  const reply = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, statusText: '', json: () => Promise.resolve(body) })
  const day = { phase: 'live', scheduleVersion: 1, quizzes: [], benches: {}, notOnSchedule: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
      if (path === '/api/meets/fall') return reply(200, { meet, officialCodes: [] })
      if (path === '/api/my-meets') return reply(200, { memberships: [] })
      if (path === '/api/meets/7/results/sender') return reply(403, { error: 'No' })
      if (path === '/api/meets/7/day') return reply(200, structuredClone(day))
      if (path === '/api/meets/7/schedule/published') {
        return reply(200, { document: schedule, publishedAt: '2026-11-02', view: 'letters' })
      }
      return reply(404, { error: path })
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('the Schedule tab on a phone', () => {
  it('lists the schedule by time rather than drawing the sheet, each quiz with its division', async () => {
    stubApi(published())
    await router.push('/fall')
    const w = mount(RouterView, { global: { plugins: [router] } })
    await flushPromises()
    expect(w.find('.schedule-list').exists()).toBe(true)
    expect(w.find('.sheet').exists()).toBe(false)
    expect(w.find('.where').text()).toMatch(/· [12]$/)
    w.unmount()
  })

  it('lists the display schedule by time too, its quizzes opening nothing', async () => {
    stubApi(published())
    await router.push('/fall/display')
    const w = mount(RouterView, { global: { plugins: [router] } })
    await flushPromises()
    expect(w.find('.schedule-list').exists()).toBe(true)
    expect(w.find('.sheet').exists()).toBe(false)
    expect(w.find('.schedule-list a').exists()).toBe(false)
    w.unmount()
  })
})
