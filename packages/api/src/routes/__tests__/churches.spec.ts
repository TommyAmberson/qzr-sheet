import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Bindings } from '../../bindings'
import type { ChurchesVariables } from '../churches'
import { churches } from '../churches'
import { mockSession, mockDb, testAdmin, testUser } from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'
import * as schema from '../../db/schema'
import { generateCode, hashCode } from '../../lib/codes'

const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(user: typeof testAdmin | typeof testUser | null, db: Db) {
  const app = new Hono<{ Bindings: Bindings; Variables: ChurchesVariables }>()
  app.use('*', mockSession(user))
  app.use('*', mockDb(db))
  app.route('/api', churches)
  return app
}

function post(body: Record<string, unknown>) {
  return {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function patch(body: Record<string, unknown>) {
  return {
    method: 'PATCH' as const,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ---- Seed helpers ----

async function seedMeet(db: Db) {
  const hash = await hashCode(generateCode())
  const [meet] = await db
    .insert(schema.quizMeets)
    .values({
      name: 'Test Meet',
      dateFrom: '2025-06-01',
      dateTo: null,
      viewerCode: 'test-viewer',
      coachCodeHash: hash,
      createdAt: new Date(),
    })
    .returning()
  return meet!
}

async function seedCoachMembership(db: Db, userId: string, meetId: number) {
  await db.insert(schema.coachMemberships).values({ accountId: userId, meetId })
}

async function seedChurch(db: Db, meetId: number, createdBy: string, name = 'Grace Church') {
  const [church] = await db
    .insert(schema.churches)
    .values({ meetId, createdBy, name, shortName: 'GC' })
    .returning()
  return church!
}

async function seedTeam(db: Db, meetId: number, churchId: number, division = 'Open') {
  const [team] = await db
    .insert(schema.teams)
    .values({ meetId, churchId, division, number: 1 })
    .returning()
  return team!
}

// ---- Churches ----

describe('GET /api/meets/:meetId/churches', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('requires auth', async () => {
    const app = createApp(null, db)
    const meet = await seedMeet(db)
    const res = await app.request(`/api/meets/${meet.id}/churches`, {}, env)
    expect(res.status).toBe(401)
  })

  it('coach sees only own churches', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    await seedCoachMembership(db, testUser.id, meet.id)

    await seedChurch(db, meet.id, testUser.id, 'My Church')
    await seedChurch(db, meet.id, testAdmin.id, 'Other Church')

    const res = await app.request(`/api/meets/${meet.id}/churches`, {}, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ churches: unknown[] }>()
    expect(body.churches).toHaveLength(1)
    expect((body.churches[0] as { name: string }).name).toBe('My Church')
  })

  it('admin sees all churches', async () => {
    const app = createApp(testAdmin, db)
    const meet = await seedMeet(db)
    await seedChurch(db, meet.id, testUser.id, 'Church A')
    await seedChurch(db, meet.id, testAdmin.id, 'Church B')

    const res = await app.request(`/api/meets/${meet.id}/churches`, {}, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ churches: unknown[] }>()
    expect(body.churches).toHaveLength(2)
  })
})

describe('POST /api/meets/:meetId/churches', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('coach with membership can create a church', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    await seedCoachMembership(db, testUser.id, meet.id)

    const res = await app.request(
      `/api/meets/${meet.id}/churches`,
      post({ name: 'Grace Church', shortName: 'GC' }),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ church: { name: string; shortName: string } }>()
    expect(body.church.name).toBe('Grace Church')
    expect(body.church.shortName).toBe('GC')
  })

  it('rejects coach without membership with 403', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/churches`,
      post({ name: 'Grace Church', shortName: 'GC' }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('admin can create without membership', async () => {
    const app = createApp(testAdmin, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/churches`,
      post({ name: 'Admin Church', shortName: 'AC' }),
      env,
    )
    expect(res.status).toBe(201)
  })

  it('rejects missing fields with 400', async () => {
    const app = createApp(testAdmin, db)
    const meet = await seedMeet(db)

    const res = await app.request(`/api/meets/${meet.id}/churches`, post({ name: 'No short' }), env)
    expect(res.status).toBe(400)
  })
})

// ---- Teams ----

describe('GET /api/churches/:churchId/teams', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('returns teams for owned church', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)
    await seedTeam(db, meet.id, church.id, 'Open')
    await seedTeam(db, meet.id, church.id, 'Teen')

    // Fix: second team needs number 1 in its own division — already the case since seedTeam always uses 1.
    const res = await app.request(`/api/churches/${church.id}/teams`, {}, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ teams: unknown[] }>()
    expect(body.teams).toHaveLength(2)
  })

  it('forbids access to another coach\u2019s church', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testAdmin.id)

    const res = await app.request(`/api/churches/${church.id}/teams`, {}, env)
    expect(res.status).toBe(403)
  })
})

describe('POST /api/churches/:churchId/teams', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('creates a team with auto-numbered 1 for first in division', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)

    const res = await app.request(
      `/api/churches/${church.id}/teams`,
      post({ division: 'Open' }),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ team: { division: string; number: number } }>()
    expect(body.team.division).toBe('Open')
    expect(body.team.number).toBe(1)
  })

  it('increments number for second team in same division', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)

    await app.request(`/api/churches/${church.id}/teams`, post({ division: 'Open' }), env)
    const res = await app.request(
      `/api/churches/${church.id}/teams`,
      post({ division: 'Open' }),
      env,
    )
    const body = await res.json<{ team: { number: number } }>()
    expect(body.team.number).toBe(2)
  })

  it('rejects missing division with 400', async () => {
    const app = createApp(testAdmin, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testAdmin.id)

    const res = await app.request(`/api/churches/${church.id}/teams`, post({}), env)
    expect(res.status).toBe(400)
  })
})

// ---- Quizzers ----

describe('GET /api/teams/:teamId/quizzers', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('returns roster entries', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)
    const team = await seedTeam(db, meet.id, church.id)

    const [id1] = await db.insert(schema.quizzerIdentities).values({}).returning()
    const [id2] = await db.insert(schema.quizzerIdentities).values({}).returning()
    await db.insert(schema.teamRosters).values([
      { teamId: team.id, quizzerId: id1!.id, name: 'Alice' },
      { teamId: team.id, quizzerId: id2!.id, name: 'Bob' },
    ])

    const res = await app.request(`/api/teams/${team.id}/quizzers`, {}, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ quizzers: { name: string }[] }>()
    expect(body.quizzers.map((q) => q.name).sort()).toEqual(['Alice', 'Bob'])
  })
})

describe('POST /api/teams/:teamId/quizzers', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('adds a quizzer to the team', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)
    const team = await seedTeam(db, meet.id, church.id)

    const res = await app.request(`/api/teams/${team.id}/quizzers`, post({ name: 'Charlie' }), env)
    expect(res.status).toBe(201)
    const body = await res.json<{ quizzer: { name: string; quizzerId: number } }>()
    expect(body.quizzer.name).toBe('Charlie')
    expect(body.quizzer.quizzerId).toBeTypeOf('number')
  })

  it('rejects missing name with 400', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)
    const team = await seedTeam(db, meet.id, church.id)

    const res = await app.request(`/api/teams/${team.id}/quizzers`, post({}), env)
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/teams/:teamId/quizzers/:quizzerId', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('updates the quizzer name', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)
    const team = await seedTeam(db, meet.id, church.id)

    const [identity] = await db.insert(schema.quizzerIdentities).values({}).returning()
    await db
      .insert(schema.teamRosters)
      .values({ teamId: team.id, quizzerId: identity!.id, name: 'Old Name' })

    const res = await app.request(
      `/api/teams/${team.id}/quizzers/${identity!.id}`,
      patch({ name: 'New Name' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{ quizzer: { name: string } }>()
    expect(body.quizzer.name).toBe('New Name')
  })

  it('returns 404 for unknown quizzer', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)
    const team = await seedTeam(db, meet.id, church.id)

    const res = await app.request(
      `/api/teams/${team.id}/quizzers/9999`,
      patch({ name: 'Ghost' }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/teams/:teamId/quizzers/:quizzerId', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('removes the quizzer from the roster', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)
    const team = await seedTeam(db, meet.id, church.id)

    const [identity] = await db.insert(schema.quizzerIdentities).values({}).returning()
    await db
      .insert(schema.teamRosters)
      .values({ teamId: team.id, quizzerId: identity!.id, name: 'Dave' })

    const res = await app.request(
      `/api/teams/${team.id}/quizzers/${identity!.id}`,
      { method: 'DELETE' },
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{ deleted: boolean }>()
    expect(body.deleted).toBe(true)
  })

  it('returns 404 when quizzer not on team', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, testUser.id)
    const team = await seedTeam(db, meet.id, church.id)

    const res = await app.request(`/api/teams/${team.id}/quizzers/9999`, { method: 'DELETE' }, env)
    expect(res.status).toBe(404)
  })
})
