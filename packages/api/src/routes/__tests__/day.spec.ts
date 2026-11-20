import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import {
  DEFAULT_STATS_SETTINGS,
  MeetRole,
  newScheduleDocument,
  type MeetDay,
  type QuizFile,
  type ScheduleQuiz,
  type StatsSettings,
} from '@qzr/shared'
import { eq } from 'drizzle-orm'
import { fifteenQuestionQuizFile } from '../../../../shared/src/scoring/__tests__/fixtures/fifteenQuestionQuiz'
import type { Bindings } from '../../bindings'
import type { SessionUser, SessionVariables } from '../../middleware/session'
import type { GuestPayload } from '../../lib/jwt'
import { day } from '../day'
import { results } from '../results'
import { stats } from '../stats'
import * as schema from '../../db/schema'
import {
  mockSession,
  mockDb,
  testSuperuser,
  testUser,
  jsonOf,
  jsonRequest,
  seedMeet,
} from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'

// The meet day (specs/010-meet-day, contracts/meet-day-api.md)

const env = {
  ENVIRONMENT: 'test',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
} as unknown as Bindings

let db: Db
let meetId: number

function as(user: SessionUser | null, guest: GuestPayload | null = null) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(user, guest))
  app.use('*', mockDb(db))
  app.route('/api/meets', results)
  app.route('/api/meets', stats)
  app.route('/api/meets', day)
  return app
}

const viewer = () => ({ meetId, role: MeetRole.Viewer }) as GuestPayload
const read = (user: SessionUser | null, guest: GuestPayload | null = null) =>
  as(user, guest).request(`/api/meets/${meetId}/day`, {}, env)
const asAdmin = async () => jsonOf<MeetDay>(await read(testSuperuser))
const asViewer = async () => jsonOf<MeetDay>(await read(null, viewer()))

const scheduled = (id: string, label: string): ScheduleQuiz => ({
  id,
  label,
  division: '1',
  phase: 'prelim',
  cell: null,
  // Placed on benches by letters the meet hasn't drawn, so any three teams play it
  seats: ['a', 'b', 'c'].map((letter) => ({ kind: 'letter' as const, letter })),
  pinned: false,
})

beforeEach(async () => {
  db = await createTestDb()
  meetId = (await seedMeet(db, 'Day Meet', { phase: 'live' })).id
  await db
    .update(schema.quizMeets)
    .set({ divisions: JSON.stringify(['1']) })
    .where(eq(schema.quizMeets.id, meetId))
  const document = newScheduleDocument('Day Meet')
  // A schedule linked to the meet names its divisions as the meet does
  document.settings.divisions = [{ id: '1', name: '1', teams: 3, elims: { lanes: [], lines: [] } }]
  document.quizzes = [scheduled('p1', 'Div 1 Quiz 1'), scheduled('p2', 'Div 1 Quiz 2')]
  await db.insert(schema.meetScheduleVersions).values({
    meetId,
    version: 1,
    document: JSON.stringify(document),
    publishedAt: new Date(),
    publishedByName: 'Test Admin',
  })
})

afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches
})

/** Store a quiz of division 1, which links itself to the scheduled quiz of its name */
async function store(quizNumber: string, change: (file: QuizFile) => void = () => {}) {
  const quizFile = fifteenQuestionQuizFile()
  quizFile.quiz.quizNumber = quizNumber
  change(quizFile)
  const res = await as(testSuperuser).request(
    `/api/meets/${meetId}/results`,
    jsonRequest('POST', { quizFile }),
    env,
  )
  expect(res.status).toBe(201)
  return (await jsonOf<{ id: number }>(res)).id
}

const saveSettings = (change: (s: StatsSettings) => void) => {
  const settings = structuredClone(DEFAULT_STATS_SETTINGS)
  change(settings)
  return as(testSuperuser).request(
    `/api/meets/${meetId}/stats/settings`,
    jsonRequest('PUT', { settings }),
    env,
  )
}

describe('GET /api/meets/:id/day', () => {
  it('gives an admin each scheduled quiz with its result, the quizzes not on it, and a count', async () => {
    const id = await store('1')
    const unscheduled = await store('9')
    const body = await asAdmin()
    expect(body.scheduleVersion).toBe(1)
    const [p1, p2] = body.quizzes
    expect(p1).toMatchObject({ id: 'p1', status: 'played', storedId: id })
    expect(p1!.teams.map((t) => [t.name, t.place])).toEqual([
      ['Team A', 1],
      ['Team B', 3],
      ['Team C', 2],
    ])
    expect(p1!.teams[0]!.score).toBe(200)
    expect(p2).toEqual({ id: 'p2', status: 'notIn', teams: [] })
    expect(body.notOnSchedule).toEqual([
      expect.objectContaining({ name: 'D1 Q9', storedId: unscheduled, stage: null }),
    ])
    expect(typeof body.attention).toBe('number')
  })

  it("gives a viewer what a division's stats would: places, no scores, no ids or attention", async () => {
    await store('1')
    await store('9')
    const body = await asViewer()
    const [p1, p2] = body.quizzes
    expect(p1!.status).toBe('played')
    expect(p1!.teams[0]).toEqual({ name: 'Team A', place: 1 })
    expect(p1).not.toHaveProperty('storedId')
    expect(p2!.status).toBe('notIn')
    // A stored quiz with no stage is never listed for a viewer
    expect(body.notOnSchedule).toEqual([])
    expect(body).not.toHaveProperty('attention')
  })

  it('hides every quiz of a stage a viewer may not see yet, in or not', async () => {
    await store('1')
    expect(
      (await saveSettings((s) => (s.results.prelim = { from: 'meetDone', level: 'scores' })))
        .status,
    ).toBe(200)
    const body = await asViewer()
    expect(body.quizzes.map((q) => [q.id, q.status, q.teams])).toEqual([
      ['p1', 'hidden', []],
      ['p2', 'hidden', []],
    ])
    // The admin still sees it played
    expect((await asAdmin()).quizzes[0]!.status).toBe('played')
  })

  it('shows a quiz in error as needing attention to an admin and under review to a viewer', async () => {
    await store('1', (file) => (file.answers = file.answers.filter((a) => a.columnKey !== '15')))
    expect((await asAdmin()).quizzes[0]).toMatchObject({
      status: 'attention',
      problems: [expect.objectContaining({ kind: 'unanswered' })],
    })
    const seen = (await asViewer()).quizzes[0]!
    expect(seen.status).toBe('underReview')
    expect(seen.teams).toEqual([{ name: 'Team A' }, { name: 'Team B' }, { name: 'Team C' }])
  })

  it('serves viewers a recent copy, and admins never', async () => {
    const kept = new Map<string, Response>()
    ;(globalThis as { caches?: unknown }).caches = {
      default: {
        match: async (key: Request) => kept.get(key.url)?.clone(),
        put: async (key: Request, response: Response) => void kept.set(key.url, response),
      },
    }
    await asViewer()
    await store('1')
    expect((await asViewer()).quizzes[0]!.status).toBe('notIn')
    expect((await asAdmin()).quizzes[0]!.status).toBe('played')
  })

  it('leaves unsettled the benches fed by a quiz its own benches show was played by the wrong teams', async () => {
    const document = newScheduleDocument('Day Meet')
    document.settings.divisions = [
      { id: '1', name: '1', teams: 3, elims: { lanes: [], lines: [] } },
    ]
    const elim = (id: string, benches: ScheduleQuiz['seats']): ScheduleQuiz => ({
      ...scheduled(id, `Div 1 Quiz ${id}`),
      phase: 'elim',
      lane: 0,
      seats: benches,
    })
    document.quizzes = [
      elim(
        'A',
        [1, 2, 3].map((rank) => ({ kind: 'rank' as const, rank })),
      ),
      elim(
        'F',
        [1, 2, 3].map((place) => ({ kind: 'place' as const, quiz: 'A', place })),
      ),
    ]
    await db.insert(schema.meetScheduleVersions).values({
      meetId,
      version: 2,
      document: JSON.stringify(document),
      publishedAt: new Date(),
      publishedByName: 'Test Admin',
    })
    // The prelims sent other teams to quiz A than the ones that played it
    await db.insert(schema.divisionConfirmations).values({
      meetId,
      division: '1',
      what: 'prelims',
      confirmed: true,
      teams: JSON.stringify(
        ['Team X', 'Team Y', 'Team Z'].map((name, i) => ({ name, rank: i + 1, tied: false })),
      ),
      byName: 'Test Admin',
      at: new Date(),
    })
    await store('A')
    const body = await asAdmin()
    expect(body.quizzes.find((q) => q.id === 'A')!.status).toBe('attention')
    expect(body.benches['A:0']).toEqual({ team: 'Team X' })
    expect(body.benches).not.toHaveProperty('F:0')
  })

  it('shows a quiz set not to count as such to an admin, and as not in to a viewer', async () => {
    const id = await store('1')
    const res = await as(testSuperuser).request(
      `/api/meets/${meetId}/results/stage`,
      jsonRequest('PATCH', { ids: [id], stage: 'notCounted' }),
      env,
    )
    expect(res.status).toBe(200)
    expect((await asAdmin()).quizzes[0]).toMatchObject({
      status: 'notCounted',
      storedId: id,
      teams: [{ name: 'Team A' }, { name: 'Team B' }, { name: 'Team C' }],
    })
    expect((await asViewer()).quizzes[0]).toEqual({ id: 'p1', status: 'notIn', teams: [] })
  })

  it('keeps listing a quiz whose scheduled quiz another is linked to by hand', async () => {
    const first = await store('1')
    // Saved under another name, then linked by hand to the scheduled quiz the first one has
    const second = await store('7')
    const res = await as(testSuperuser).request(
      `/api/meets/${meetId}/results/${second}/link`,
      jsonRequest('PUT', { scheduleQuizId: 'p1' }),
      env,
    )
    expect(res.status).toBe(200)
    // The hand link takes the scheduled quiz over, and the first is still listed
    const body = await asAdmin()
    expect(body.quizzes[0]!.storedId).toBe(second)
    expect(body.notOnSchedule.map((q) => q.storedId)).toContain(first)
  })

  it('refuses a caller with no session and an account that is not a member', async () => {
    expect((await read(null)).status).toBe(401)
    expect((await read(testUser)).status).toBe(403)
  })
})
