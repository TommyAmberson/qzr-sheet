import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Bindings } from '../../bindings'
import type { SessionVariables } from '../../middleware/session'
import { phase } from '../phase'
import * as schema from '../../db/schema'
import { mockSession, mockDb, testSuperuser, testUser, jsonOf } from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'

const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(user: typeof testSuperuser | typeof testUser | null, db: Db) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables & { db: Db } }>()
  app.use('*', mockSession(user))
  app.use('*', mockDb(db))
  app.route('/api/meets', phase)
  return app
}

function postJson(body: Record<string, unknown>) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function seedMeet(db: Db, name = 'Test Meet') {
  const [meet] = await db
    .insert(schema.quizMeets)
    .values({
      name,
      dateFrom: '2026-01-01',
      adminCodeHash: 'x',
      viewerCode: name.toLowerCase().replace(/\s+/g, '-'),
      createdAt: new Date(),
    })
    .returning()
  return meet!
}

describe('POST /api/meets/:id/phase', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('advances registration → build', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(`/api/meets/${meet.id}/phase`, postJson({ phase: 'build' }), env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ phase: string; reversed: boolean }>(res)
    expect(body.phase).toBe('build')
    expect(body.reversed).toBe(false)

    const [updated] = await db
      .select({ phase: schema.quizMeets.phase })
      .from(schema.quizMeets)
      .where(eq(schema.quizMeets.id, meet.id))
    expect(updated?.phase).toBe('build')
  })

  it('flags reverse transitions', async () => {
    const meet = await seedMeet(db)
    await db.update(schema.quizMeets).set({ phase: 'live' }).where(eq(schema.quizMeets.id, meet.id))

    const res = await app.request(`/api/meets/${meet.id}/phase`, postJson({ phase: 'build' }), env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ phase: string; reversed: boolean }>(res)
    expect(body.phase).toBe('build')
    expect(body.reversed).toBe(true)
  })

  it('rejects multi-step transitions', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(`/api/meets/${meet.id}/phase`, postJson({ phase: 'live' }), env)
    expect(res.status).toBe(400)
  })

  it('rejects invalid phase value', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(`/api/meets/${meet.id}/phase`, postJson({ phase: 'bogus' }), env)
    expect(res.status).toBe(400)
  })

  it('returns unchanged when target equals current', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(
      `/api/meets/${meet.id}/phase`,
      postJson({ phase: 'registration' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ unchanged?: boolean }>(res)
    expect(body.unchanged).toBe(true)
  })

  it('requires admin', async () => {
    const meet = await seedMeet(db)
    const userApp = createApp(testUser, db)
    const res = await userApp.request(
      `/api/meets/${meet.id}/phase`,
      postJson({ phase: 'build' }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 for missing meet', async () => {
    const res = await app.request('/api/meets/99999/phase', postJson({ phase: 'build' }), env)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/meets/:id/divisions/:division/state', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  async function liveMeet(name = 'Live Meet') {
    const meet = await seedMeet(db, name)
    await db.update(schema.quizMeets).set({ phase: 'live' }).where(eq(schema.quizMeets.id, meet.id))
    return meet
  }

  it('initializes division at prelim_running implicitly on first transition', async () => {
    const meet = await liveMeet()
    const res = await app.request(
      `/api/meets/${meet.id}/divisions/Division 1/state`,
      postJson({ state: 'stats_break' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ state: string }>(res)
    expect(body.state).toBe('stats_break')

    const [row] = await db
      .select()
      .from(schema.divisionStates)
      .where(eq(schema.divisionStates.meetId, meet.id))
    expect(row?.state).toBe('stats_break')
  })

  it('rejects multi-step from implicit prelim_running', async () => {
    const meet = await liveMeet()
    const res = await app.request(
      `/api/meets/${meet.id}/divisions/Division 1/state`,
      postJson({ state: 'elim_running' }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('advances stats_break → elim_running', async () => {
    const meet = await liveMeet()
    await db.insert(schema.divisionStates).values({
      meetId: meet.id,
      division: 'Division 1',
      state: 'stats_break',
      transitionedAt: new Date(),
    })

    const res = await app.request(
      `/api/meets/${meet.id}/divisions/Division 1/state`,
      postJson({ state: 'elim_running' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ state: string }>(res)
    expect(body.state).toBe('elim_running')
  })

  it('flags reverse transitions', async () => {
    const meet = await liveMeet()
    await db.insert(schema.divisionStates).values({
      meetId: meet.id,
      division: 'Division 1',
      state: 'elim_running',
      transitionedAt: new Date(),
    })

    const res = await app.request(
      `/api/meets/${meet.id}/divisions/Division 1/state`,
      postJson({ state: 'stats_break' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<{ state: string; reversed: boolean }>(res)
    expect(body.state).toBe('stats_break')
    expect(body.reversed).toBe(true)
  })

  it('rejects state changes when meet is not live', async () => {
    const meet = await seedMeet(db) // phase='registration'
    const res = await app.request(
      `/api/meets/${meet.id}/divisions/Division 1/state`,
      postJson({ state: 'stats_break' }),
      env,
    )
    expect(res.status).toBe(409)
  })

  it('requires admin', async () => {
    const meet = await liveMeet()
    const userApp = createApp(testUser, db)
    const res = await userApp.request(
      `/api/meets/${meet.id}/divisions/Division 1/state`,
      postJson({ state: 'stats_break' }),
      env,
    )
    expect(res.status).toBe(403)
  })
})

describe('GET /api/meets/:id/divisions/state', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('returns empty list when no transitions yet', async () => {
    const meet = await seedMeet(db)
    const res = await app.request(`/api/meets/${meet.id}/divisions/state`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ divisionStates: unknown[] }>(res)
    expect(body.divisionStates).toEqual([])
  })

  it('returns recorded states', async () => {
    const meet = await seedMeet(db)
    await db.insert(schema.divisionStates).values([
      {
        meetId: meet.id,
        division: 'Division 1',
        state: 'stats_break',
        transitionedAt: new Date(),
      },
      {
        meetId: meet.id,
        division: 'Division 2',
        state: 'elim_running',
        transitionedAt: new Date(),
      },
    ])

    const res = await app.request(`/api/meets/${meet.id}/divisions/state`, {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ divisionStates: { division: string; state: string }[] }>(res)
    expect(body.divisionStates).toHaveLength(2)
    const states = body.divisionStates.reduce<Record<string, string>>(
      (acc, r) => ({ ...acc, [r.division]: r.state }),
      {},
    )
    expect(states['Division 1']).toBe('stats_break')
    expect(states['Division 2']).toBe('elim_running')
  })
})
