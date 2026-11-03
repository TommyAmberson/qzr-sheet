import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import {
  checkSchedule,
  generateSchedule,
  newScheduleDocument,
  resultName,
  type ScheduleDocument,
} from '@qzr/shared'

import { readLink } from '../builder/linked'
import { keepSchedule, loadSchedule } from '../builder/persistence'
import router from '../router'
import LinkedBuilderView from '../views/LinkedBuilderView.vue'

/** An in-memory API for one meet: its teams and rooms, and the linked schedule routes */
function fakeServer() {
  const meet = {
    id: 7,
    name: 'Fall Meet',
    dateFrom: '2026-11-20',
    dateTo: null,
    viewerCode: 'fall',
    divisions: ['1'],
    createdAt: '2026-01-01',
  }
  const teams = Array.from({ length: 6 }, (_, i) => ({
    id: 100 + i,
    churchId: 1,
    churchName: 'Grace Church',
    churchShortName: 'Grace',
    division: '1',
    number: i + 1,
    consolation: false,
    lateness: i === 5,
  }))
  const server = {
    offline: false,
    draft: null as ScheduleDocument | null,
    revision: 0,
    versions: [] as { version: number; document: ScheduleDocument; publishedAt: string }[],
    results: [] as string[],
    puts: 0,
  }
  const reply = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, statusText: '', json: () => Promise.resolve(body) })

  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body as string) : {}
    if (server.offline && method !== 'GET') return Promise.reject(new TypeError('Failed to fetch'))
    if (path === '/api/meets/fall') return reply(200, { meet, officialCodes: [] })
    if (path === '/api/meets/7/teams') return reply(200, { teams, meetDivisions: ['1'] })
    if (path === '/api/meets/7/rooms') return reply(200, { rooms: [] })
    if (path === '/api/meets/7/schedule' && method === 'GET') {
      const newest = server.versions[server.versions.length - 1]
      return reply(200, {
        draft: server.draft,
        draftRevision: server.revision,
        draftSavedAt: null,
        published: newest?.document ?? null,
        publishedAt: newest?.publishedAt ?? null,
        version: newest?.version ?? null,
        results: server.results,
      })
    }
    if (path === '/api/meets/7/schedule' && method === 'DELETE') {
      server.draft = null
      return reply(200, { ok: true })
    }
    if (path === '/api/meets/7/schedule/draft') {
      server.puts++
      if (body.baseRevision !== server.revision) {
        return reply(409, { error: 'stale', draft: server.draft, draftRevision: server.revision })
      }
      server.draft = body.document
      server.revision++
      return reply(200, { draftRevision: server.revision, draftSavedAt: '2026-11-02T00:00:00Z' })
    }
    if (path === '/api/meets/7/schedule/publish') {
      if (body.baseRevision !== server.revision) return reply(409, { error: 'stale' })
      const conflicts = checkSchedule(server.draft!).filter((c) => !c.warning)
      if (conflicts.length > 0 && !body.confirmConflicts) {
        return reply(409, { error: 'conflicts', conflicts })
      }
      server.draft!.rooms.forEach((r, i) => (r.meetRoomId ??= 500 + i))
      server.revision++
      const version = server.versions.length + 1
      server.versions.push({
        version,
        document: structuredClone(server.draft!),
        publishedAt: '2026-11-02T00:00:00Z',
      })
      return reply(200, {
        version,
        publishedAt: '2026-11-02T00:00:00Z',
        draftRevision: server.revision,
        draftSavedAt: '2026-11-02T00:00:00Z',
        rooms: server.draft!.rooms,
        unusedRooms: [],
      })
    }
    if (path === '/api/meets/7/schedule/versions') {
      return reply(
        200,
        [...server.versions]
          .reverse()
          .map((v) => ({ version: v.version, publishedAt: v.publishedAt, publishedBy: 'Pat' })),
      )
    }
    const one = /^\/api\/meets\/7\/schedule\/versions\/(\d+)(\/restore)?$/.exec(path)
    if (one) {
      const v = server.versions[Number(one[1]) - 1]!
      if (!one[2]) return reply(200, { ...v, publishedBy: 'Pat' })
      if (body.baseRevision !== server.revision) return reply(409, { error: 'stale' })
      server.draft = structuredClone(v.document)
      server.revision++
      return reply(200, { draftRevision: server.revision, draftSavedAt: '2026-11-02T00:00:00Z' })
    }
    return reply(404, { error: `no route ${method} ${path}` })
  })
  vi.stubGlobal('fetch', fetch)
  return { server, meet, teams }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function openBuilder() {
  const w = mount(LinkedBuilderView, {
    props: { slug: 'fall' },
    attachTo: document.body,
    global: { plugins: [router] },
  })
  await flushPromises()
  return w
}

/** A draft already on the server, as if saved earlier */
function serverDraft(server: ReturnType<typeof fakeServer>['server']) {
  const base = newScheduleDocument('Fall Meet')
  base.settings.divisions = [{ id: '1', name: 'Div 1', teams: 6, elims: { lanes: [], lines: [] } }]
  base.settings.autoApply = false
  const doc = generateSchedule(base)
  doc.link = { meetId: 7, timeZone: 'UTC' }
  server.draft = doc
  server.revision = 1
  return doc
}

const button = (w: ReturnType<typeof mount>, text: string) =>
  w.findAll('button').find((b) => b.text() === text)

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('a linked schedule in the builder (story 7)', () => {
  it('starts from the meet: its division, team count and late teams, saved at once (FR-047)', async () => {
    const { server } = fakeServer()
    const w = await openBuilder()
    await button(w, 'Start from the meet')!.trigger('click')
    await flushPromises()
    expect(server.revision).toBe(1)
    const doc = server.draft!
    expect(doc.link).toMatchObject({ meetId: 7 })
    expect(doc.settings.divisions).toMatchObject([{ id: '1', teams: 6 }])
    expect(doc.draw['1']!.teams.map((t) => t.teamId)).toEqual([100, 101, 102, 103, 104, 105])
    expect(doc.draw['1']!.teams[5]!.late).toBe(true)
    expect(w.find('.save-state').text()).toBe('Saved')
    w.unmount()
  })

  it('links a kept schedule only once confirmed, listing what differs from the meet (FR-046)', async () => {
    const { server } = fakeServer()
    const kept = newScheduleDocument('Practice')
    kept.settings.divisions = [
      { id: '1', name: 'Div 1', teams: 5, elims: { lanes: [], lines: [] } },
    ]
    keepSchedule(generateSchedule(kept))
    const w = await openBuilder()
    await w.find('[aria-label="Schedule to link"]').setValue(kept.id)
    expect(w.find('.matching .mismatch').exists()).toBe(true)
    expect(server.puts).toBe(0)

    await button(w, 'Link this schedule')!.trigger('click')
    await flushPromises()
    expect(server.draft!.draw['1']!.teams.map((t) => t.teamId)).toHaveLength(6)
    // The kept schedule stays as it was
    expect(loadSchedule(kept.id)!.link).toBeUndefined()
    w.unmount()
  })

  it("carries a kept draw to the meet's teams by name, never by position", async () => {
    const { server } = fakeServer()
    const base = newScheduleDocument('Named')
    base.settings.divisions = [
      { id: '1', name: 'Div 1', teams: 6, elims: { lanes: [], lines: [] } },
    ]
    const kept = generateSchedule(base)
    kept.draw['1'] = {
      stale: false,
      teams: [
        { name: 'Grace 2', letter: 'A', late: true, absent: false },
        { name: 'Elsewhere 9', letter: 'B', late: false, absent: false },
      ],
    }
    keepSchedule(kept)
    const w = await openBuilder()
    await w.find('[aria-label="Schedule to link"]').setValue(kept.id)
    await button(w, 'Link this schedule')!.trigger('click')
    await flushPromises()
    const draw = server.draft!.draw['1']!
    expect(draw.teams.find((t) => t.teamId === 101)).toMatchObject({ letter: 'A', late: true })
    expect(draw.teams.filter((t) => t.letter)).toHaveLength(1)
    expect(draw.stale).toBe(true)
    w.unmount()
  })

  it("brings the draw up to the meet's teams, dropping one that left and adding one that joined", async () => {
    const { server } = fakeServer()
    const doc = serverDraft(server)
    doc.draw['1'] = {
      stale: false,
      teams: [100, 101, 102, 103, 104, 999].map((teamId, i) => ({
        teamId,
        letter: 'ABCDEF'[i],
        late: false,
        absent: false,
      })),
    }
    const w = await openBuilder()
    await sleep(900)
    await flushPromises()
    const draw = server.draft!.draw['1']!
    expect(draw.teams.map((t) => t.teamId)).toEqual([100, 101, 102, 103, 104, 105])
    expect(draw.stale).toBe(true)
    w.unmount()
  })

  it("takes each division's team count from the meet, and the grid follows", async () => {
    const { server } = fakeServer()
    const doc = serverDraft(server)
    doc.settings.divisions[0]!.teams = 5
    doc.settings.autoApply = true
    doc.applied.autoApply = true
    doc.draw['1'] = {
      stale: false,
      teams: [100, 101, 102, 103, 104].map((teamId) => ({ teamId, late: false, absent: false })),
    }
    const w = await openBuilder()
    await sleep(900)
    await flushPromises()
    expect(server.draft!.settings.divisions[0]!.teams).toBe(6)
    expect(server.draft!.draw['1']!.teams).toHaveLength(6)
    const letters = new Set(
      server.draft!.quizzes.flatMap((q) =>
        q.seats.flatMap((s) => (s.kind === 'letter' ? [s.letter] : [])),
      ),
    )
    expect(letters.has('F')).toBe(true)
    w.unmount()
  })

  it('unlinking leaves a schedule of its own in this browser (FR-048)', async () => {
    const { server } = fakeServer()
    serverDraft(server)
    const w = await openBuilder()
    await button(w, 'Unlink')!.trigger('click')
    await w
      .findAll('.message button')
      .find((b) => b.text() === 'Unlink')!
      .trigger('click')
    await flushPromises()
    expect(server.draft).toBeNull()
    const route = router.currentRoute.value
    expect(route.name).toBe('builder-schedule')
    expect(loadSchedule(route.params.id as string)!.link).toBeUndefined()
    w.unmount()
  })
})

describe('saving a linked draft (FR-048a)', () => {
  it('keeps edits made offline, through a reload, and sends them when back online', async () => {
    const { server } = fakeServer()
    serverDraft(server)
    server.offline = true
    const w = await openBuilder()
    const name = w.find('[aria-label="Schedule name"]')
    await name.setValue('Fall Meet 2026')
    await name.trigger('change')
    await sleep(900)
    await flushPromises()
    expect(w.find('.save-state').text()).toBe('Not saved: offline')
    w.unmount()

    // Reload while still offline: the edit is still here, unsent
    const again = await openBuilder()
    expect(again.find<HTMLInputElement>('[aria-label="Schedule name"]').element.value).toBe(
      'Fall Meet 2026',
    )
    expect(readLink(7)?.unsent).toBe(true)

    server.offline = false
    window.dispatchEvent(new Event('online'))
    await sleep(900)
    await flushPromises()
    expect(server.draft!.name).toBe('Fall Meet 2026')
    expect(again.find('.save-state').text()).toBe('Saved')
    again.unmount()
  })

  it("shows another admin's newer draft beside mine, never overwriting either silently", async () => {
    const { server } = fakeServer()
    serverDraft(server)
    server.offline = true
    const w = await openBuilder()
    const name = w.find('[aria-label="Schedule name"]')
    await name.setValue('Mine')
    await name.trigger('change')
    await sleep(900)
    w.unmount()

    // Meanwhile another admin saves
    server.draft = { ...server.draft!, name: 'Theirs' }
    server.revision = 2
    server.offline = false
    const again = await openBuilder()
    expect(again.text()).toMatch(/Another admin saved/)
    expect(server.draft!.name).toBe('Theirs')

    await button(again, 'Keep mine')!.trigger('click')
    await flushPromises()
    expect(server.draft!.name).toBe('Mine')
    again.unmount()
  })
})

describe('publishing and history (FR-049, FR-049a)', () => {
  it('asks in the page before publishing past hard conflicts, then marks nothing unpublished', async () => {
    const { server } = fakeServer()
    const doc = serverDraft(server)
    // Two quizzes in one cell
    doc.quizzes[1]!.cell = doc.quizzes[0]!.cell
    const w = await openBuilder()
    expect(w.find('.unpublished').exists()).toBe(true)

    await button(w, 'Publish')!.trigger('click')
    await flushPromises()
    expect(w.text()).toMatch(/The schedule has \d+ problems?/)
    expect(server.versions).toHaveLength(0)

    await button(w, 'Publish anyway')!.trigger('click')
    await flushPromises()
    expect(server.versions).toHaveLength(1)
    expect(w.text()).toMatch(/Published version 1/)
    expect(w.find('.unpublished').exists()).toBe(false)
    w.unmount()
  })

  it("says why when it can't publish because the draft hasn't saved", async () => {
    const { server } = fakeServer()
    serverDraft(server)
    const w = await openBuilder()
    const name = w.find('[aria-label="Schedule name"]')
    await name.setValue('Offline edit')
    await name.trigger('change')
    server.offline = true
    await button(w, 'Publish')!.trigger('click')
    await flushPromises()
    expect(w.text()).toMatch(/Not published: not saved: offline/)
    expect(server.versions).toHaveLength(0)
    w.unmount()
  })

  it('lists versions with when and by whom, and restores one as the draft (FR-049a)', async () => {
    const { server } = fakeServer()
    serverDraft(server)
    const w = await openBuilder()
    await button(w, 'Publish')!.trigger('click')
    await flushPromises()
    const name = w.find('[aria-label="Schedule name"]')
    await name.setValue('Changed')
    await name.trigger('change')
    await sleep(900)
    await flushPromises()
    expect(server.draft!.name).toBe('Changed')

    await button(w, 'History')!.trigger('click')
    await flushPromises()
    expect(w.find('.history').text()).toMatch(/Version 1.*Pat/)
    await button(w, 'Restore as the draft')!.trigger('click')
    await flushPromises()
    expect(server.draft!.name).toBe('Fall Meet')
    expect(w.find<HTMLInputElement>('[aria-label="Schedule name"]').element.value).toBe('Fall Meet')
    expect(server.versions).toHaveLength(1)
    w.unmount()
  })

  it('protects a quiz with results: changed only after confirming, then marked (H-20)', async () => {
    const { server } = fakeServer()
    const doc = serverDraft(server)
    const quiz = doc.quizzes.find((q) => q.cell)!
    server.results = [resultName(quiz)]
    const w = await openBuilder()

    await w.find(`[data-quiz="${quiz.id}"] .quiz-title`).trigger('click')
    ;[...document.querySelectorAll<HTMLButtonElement>('.popover button')]
      .find((b) => b.textContent?.trim() === 'Move to Unplaced')!
      .click()
    await flushPromises()
    expect(w.text()).toMatch(/has results already/)
    const kept = () => loadSchedule(readLink(7)!.docId)!.quizzes.find((q) => q.id === quiz.id)!
    expect(kept().cell).not.toBeNull()

    await button(w, 'Change anyway')!.trigger('click')
    expect(kept().cell).toBeNull()
    expect(kept().changedAfterResults).toBe(true)
    w.unmount()
  })
})
