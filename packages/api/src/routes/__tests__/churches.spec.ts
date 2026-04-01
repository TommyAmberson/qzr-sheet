import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Bindings } from '../../bindings'
import type { ChurchesVariables } from '../churches'
import { churches } from '../churches'
import { mockSession, mockDb, testSuperuser, testUser, jsonOf } from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'
import * as schema from '../../db/schema'
import { generateCode, hashCode } from '../../lib/codes'

const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(user: typeof testSuperuser | typeof testUser | null, db: Db) {
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
      adminCodeHash: hash,
      createdAt: new Date(),
    })
    .returning()
  return meet!
}

async function seedAdminMembership(db: Db, userId: string, meetId: number) {
  await db.insert(schema.adminMemberships).values({ accountId: userId, meetId })
}

async function seedCoachMembership(db: Db, userId: string, churchId: number, meetId: number) {
  await db.insert(schema.coachMemberships).values({ accountId: userId, churchId, meetId })
}

async function seedChurch(db: Db, meetId: number, name = 'Grace Church') {
  const hash = await hashCode(generateCode())
  const [church] = await db
    .insert(schema.churches)
    .values({ meetId, name, shortName: 'GC', coachCodeHash: hash })
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

  it('coach sees all churches (read access is open to any member)', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church1 = await seedChurch(db, meet.id, 'My Church')
    await seedCoachMembership(db, testUser.id, church1.id, meet.id)
    await seedChurch(db, meet.id, 'Other Church')

    const res = await app.request(`/api/meets/${meet.id}/churches`, {}, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ churches: unknown[] }>()
    expect(body.churches).toHaveLength(2)
  })

  it('superuser sees all churches', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    await seedChurch(db, meet.id, 'Church A')
    await seedChurch(db, meet.id, 'Church B')

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

  it('admin with membership can create a church', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    await seedAdminMembership(db, testUser.id, meet.id)

    const res = await app.request(
      `/api/meets/${meet.id}/churches`,
      post({ name: 'Grace Church', shortName: 'GC' }),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{
      church: { name: string; shortName: string }
      coachCode: string
    }>()
    expect(body.church.name).toBe('Grace Church')
    expect(body.church.shortName).toBe('GC')
    expect(body.coachCode).toBeTypeOf('string')
  })

  it('rejects normal user without admin membership with 403', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/churches`,
      post({ name: 'Grace Church', shortName: 'GC' }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('superuser can create without membership', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/churches`,
      post({ name: 'Admin Church', shortName: 'AC' }),
      env,
    )
    expect(res.status).toBe(201)
  })

  it('rejects missing fields with 400', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)

    const res = await app.request(`/api/meets/${meet.id}/churches`, post({}), env)
    expect(res.status).toBe(400)
  })

  it('defaults shortName to name when not provided', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/churches`,
      post({ name: 'Grace Community Church' }),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ church: { name: string; shortName: string } }>()
    expect(body.church.name).toBe('Grace Community Church')
    expect(body.church.shortName).toBe('Grace Community Church')
  })

  it('defaults shortName to name when empty string', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/churches`,
      post({ name: 'Grace Community Church', shortName: '' }),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ church: { name: string; shortName: string } }>()
    expect(body.church.shortName).toBe('Grace Community Church')
  })
})

describe('DELETE /api/churches/:churchId', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('admin can delete a church', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    await seedAdminMembership(db, testUser.id, meet.id)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(`/api/churches/${church.id}`, { method: 'DELETE' }, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ deleted: boolean }>()
    expect(body.deleted).toBe(true)

    const rows = await db.select().from(schema.churches).where(eq(schema.churches.id, church.id))
    expect(rows).toHaveLength(0)
  })

  it('superuser can delete a church', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(`/api/churches/${church.id}`, { method: 'DELETE' }, env)
    expect(res.status).toBe(200)
  })

  it('cascade-deletes teams and rosters', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const team = await seedTeam(db, meet.id, church.id)

    const [identity] = await db.insert(schema.quizzerIdentities).values({}).returning()
    await db
      .insert(schema.teamRosters)
      .values({ teamId: team.id, quizzerId: identity!.id, name: 'Alice' })

    const res = await app.request(`/api/churches/${church.id}`, { method: 'DELETE' }, env)
    expect(res.status).toBe(200)

    const teams = await db.select().from(schema.teams).where(eq(schema.teams.churchId, church.id))
    expect(teams).toHaveLength(0)

    const rosters = await db
      .select()
      .from(schema.teamRosters)
      .where(eq(schema.teamRosters.teamId, team.id))
    expect(rosters).toHaveLength(0)
  })

  it('rejects coach (non-admin) with 403', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)

    const res = await app.request(`/api/churches/${church.id}`, { method: 'DELETE' }, env)
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown church', async () => {
    const app = createApp(testSuperuser, db)

    const res = await app.request('/api/churches/9999', { method: 'DELETE' }, env)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/churches/:churchId', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('admin can update name', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    await seedAdminMembership(db, testUser.id, meet.id)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(`/api/churches/${church.id}`, patch({ name: 'New Name' }), env)
    expect(res.status).toBe(200)
    const body = await res.json<{ church: { name: string; shortName: string } }>()
    expect(body.church.name).toBe('New Name')
    expect(body.church.shortName).toBe('GC')
  })

  it('admin can update shortName', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    await seedAdminMembership(db, testUser.id, meet.id)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(`/api/churches/${church.id}`, patch({ shortName: 'NEW' }), env)
    expect(res.status).toBe(200)
    const body = await res.json<{ church: { shortName: string } }>()
    expect(body.church.shortName).toBe('NEW')
  })

  it('admin can update both', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    await seedAdminMembership(db, testUser.id, meet.id)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(
      `/api/churches/${church.id}`,
      patch({ name: 'Updated Church', shortName: 'UC' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{ church: { name: string; shortName: string } }>()
    expect(body.church.name).toBe('Updated Church')
    expect(body.church.shortName).toBe('UC')
  })

  it('rejects empty body with 400', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(`/api/churches/${church.id}`, patch({}), env)
    expect(res.status).toBe(400)
  })

  it('rejects coach with 403', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)

    const res = await app.request(`/api/churches/${church.id}`, patch({ name: 'Nope' }), env)
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown church', async () => {
    const app = createApp(testSuperuser, db)

    const res = await app.request('/api/churches/9999', patch({ name: 'Ghost' }), env)
    expect(res.status).toBe(404)
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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
    await seedTeam(db, meet.id, church.id, 'Open')
    await seedTeam(db, meet.id, church.id, 'Teen')

    const res = await app.request(`/api/churches/${church.id}/teams`, {}, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ teams: unknown[] }>()
    expect(body.teams).toHaveLength(2)
  })

  it('allows any authenticated member to read teams for any church', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(`/api/churches/${church.id}/teams`, {}, env)
    expect(res.status).toBe(200)
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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)

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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)

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
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(`/api/churches/${church.id}/teams`, post({}), env)
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/teams/:teamId', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('updates division only', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
    const team = await seedTeam(db, meet.id, church.id, 'Open')

    const res = await app.request(`/api/teams/${team.id}`, patch({ division: 'Teen' }), env)
    expect(res.status).toBe(200)
    const body = await res.json<{ team: { division: string; number: number } }>()
    expect(body.team.division).toBe('Teen')
    expect(body.team.number).toBe(1)
  })

  it('updates number only', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
    const team = await seedTeam(db, meet.id, church.id, 'Open')

    const res = await app.request(`/api/teams/${team.id}`, patch({ number: 3 }), env)
    expect(res.status).toBe(200)
    const body = await res.json<{ team: { number: number; division: string } }>()
    expect(body.team.number).toBe(3)
    expect(body.team.division).toBe('Open')
  })

  it('updates both division and number', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
    const team = await seedTeam(db, meet.id, church.id, 'Open')

    const res = await app.request(
      `/api/teams/${team.id}`,
      patch({ division: 'Teen', number: 2 }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{ team: { division: string; number: number } }>()
    expect(body.team.division).toBe('Teen')
    expect(body.team.number).toBe(2)
  })

  it('rejects empty body with 400', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const team = await seedTeam(db, meet.id, church.id)

    const res = await app.request(`/api/teams/${team.id}`, patch({}), env)
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown team', async () => {
    const app = createApp(testSuperuser, db)

    const res = await app.request('/api/teams/9999', patch({ division: 'Open' }), env)
    expect(res.status).toBe(404)
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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
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
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)
    const team = await seedTeam(db, meet.id, church.id)

    const res = await app.request(`/api/teams/${team.id}/quizzers/9999`, { method: 'DELETE' }, env)
    expect(res.status).toBe(404)
  })
})

// ---- Roster sync ----

/** Seed a quizzer with a roster entry on a team. */
async function seedQuizzer(db: Db, teamId: number, name: string) {
  const [identity] = await db.insert(schema.quizzerIdentities).values({}).returning()
  await db.insert(schema.teamRosters).values({ teamId, quizzerId: identity!.id, name })
  return identity!.id
}

type SyncBody = {
  teams: Array<{ id: number; division: string; quizzers: Array<{ id: number; name: string }> }>
  unassigned: Array<{ id: number; name: string }>
}

function syncBody(body: SyncBody) {
  return {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('POST /api/churches/:churchId/roster/sync', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('requires auth', async () => {
    const app = createApp(null, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({ teams: [], unassigned: [] }),
      env,
    )
    expect(res.status).toBe(401)
  })

  it('coach can sync their own church', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    await seedCoachMembership(db, testUser.id, church.id, meet.id)

    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({ teams: [], unassigned: [] }),
      env,
    )
    expect(res.status).toBe(200)
  })

  it('rejects non-coach normal user with 403', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({ teams: [], unassigned: [] }),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('creates new teams with real IDs (negative tempId)', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [
          { id: -1, division: 'Open', quizzers: [] },
          { id: -2, division: 'Teen', quizzers: [] },
        ],
        unassigned: [],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{
      teams: Array<{ id: number; division: string; number: number }>
    }>()
    expect(body.teams).toHaveLength(2)
    expect(body.teams[0]!.id).toBeGreaterThan(0)
    expect(body.teams[0]!.division).toBe('Open')
    expect(body.teams[0]!.number).toBe(1)
    expect(body.teams[1]!.id).toBeGreaterThan(0)
    expect(body.teams[1]!.division).toBe('Teen')
    expect(body.teams[1]!.number).toBe(2)
  })

  it('deletes teams not in the payload', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const teamA = await seedTeam(db, meet.id, church.id, 'Open')
    const teamB = await seedTeam(db, meet.id, church.id, 'Teen')

    // Send only teamA
    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [{ id: teamA.id, division: 'Open', quizzers: [] }],
        unassigned: [],
      }),
      env,
    )
    expect(res.status).toBe(200)

    const remaining = await db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.churchId, church.id))
    expect(remaining.map((t) => t.id)).toEqual([teamA.id])
    void teamB
  })

  it('updates division and number on existing teams', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const teamA = await seedTeam(db, meet.id, church.id, 'Open')
    const teamB = await seedTeam(db, meet.id, church.id, 'Teen')

    // Swap order and change teamA's division
    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [
          { id: teamB.id, division: 'Teen', quizzers: [] },
          { id: teamA.id, division: 'Junior', quizzers: [] },
        ],
        unassigned: [],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{
      teams: Array<{ id: number; division: string; number: number }>
    }>()
    expect(body.teams[0]!.id).toBe(teamB.id)
    expect(body.teams[0]!.number).toBe(1)
    expect(body.teams[1]!.id).toBe(teamA.id)
    expect(body.teams[1]!.division).toBe('Junior')
    expect(body.teams[1]!.number).toBe(2)
  })

  it('creates new quizzers with real IDs (negative tempId)', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const team = await seedTeam(db, meet.id, church.id, 'Open')

    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [
          {
            id: team.id,
            division: 'Open',
            quizzers: [
              { id: -1, name: 'Alice' },
              { id: -2, name: 'Bob' },
            ],
          },
        ],
        unassigned: [],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{
      teams: Array<{ id: number; quizzers: Array<{ quizzerId: number; name: string }> }>
    }>()
    const quizzers = body.teams[0]!.quizzers
    expect(quizzers).toHaveLength(2)
    expect(quizzers[0]!.quizzerId).toBeGreaterThan(0)
    expect(quizzers[0]!.name).toBe('Alice')
    expect(quizzers[1]!.quizzerId).toBeGreaterThan(0)
    expect(quizzers[1]!.name).toBe('Bob')
  })

  it('deletes quizzers not in the payload', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const team = await seedTeam(db, meet.id, church.id, 'Open')
    const aliceId = await seedQuizzer(db, team.id, 'Alice')
    await seedQuizzer(db, team.id, 'Bob')

    // Send only Alice
    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [{ id: team.id, division: 'Open', quizzers: [{ id: aliceId, name: 'Alice' }] }],
        unassigned: [],
      }),
      env,
    )
    expect(res.status).toBe(200)

    const rosters = await db
      .select()
      .from(schema.teamRosters)
      .where(eq(schema.teamRosters.teamId, team.id))
    expect(rosters).toHaveLength(1)
    expect(rosters[0]!.quizzerId).toBe(aliceId)
  })

  it('renames an existing quizzer', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const team = await seedTeam(db, meet.id, church.id, 'Open')
    const aliceId = await seedQuizzer(db, team.id, 'Alice')

    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [{ id: team.id, division: 'Open', quizzers: [{ id: aliceId, name: 'Alicia' }] }],
        unassigned: [],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{
      teams: Array<{ quizzers: Array<{ name: string }> }>
    }>()
    expect(body.teams[0]!.quizzers[0]!.name).toBe('Alicia')
  })

  it('moves a quizzer between teams', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const teamA = await seedTeam(db, meet.id, church.id, 'Open')
    const teamB = await seedTeam(db, meet.id, church.id, 'Teen')
    const aliceId = await seedQuizzer(db, teamA.id, 'Alice')

    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [
          { id: teamA.id, division: 'Open', quizzers: [] },
          { id: teamB.id, division: 'Teen', quizzers: [{ id: aliceId, name: 'Alice' }] },
        ],
        unassigned: [],
      }),
      env,
    )
    expect(res.status).toBe(200)

    const rosterA = await db
      .select()
      .from(schema.teamRosters)
      .where(eq(schema.teamRosters.teamId, teamA.id))
    expect(rosterA).toHaveLength(0)

    const rosterB = await db
      .select()
      .from(schema.teamRosters)
      .where(eq(schema.teamRosters.teamId, teamB.id))
    expect(rosterB).toHaveLength(1)
    expect(rosterB[0]!.quizzerId).toBe(aliceId)
  })

  it('moves quizzer to unassigned (removes from team_rosters, keeps identity)', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const team = await seedTeam(db, meet.id, church.id, 'Open')
    const aliceId = await seedQuizzer(db, team.id, 'Alice')

    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [{ id: team.id, division: 'Open', quizzers: [] }],
        unassigned: [{ id: aliceId, name: 'Alice' }],
      }),
      env,
    )
    expect(res.status).toBe(200)

    const roster = await db
      .select()
      .from(schema.teamRosters)
      .where(eq(schema.teamRosters.teamId, team.id))
    expect(roster).toHaveLength(0)

    // quizzer_identity still exists
    const identity = await db
      .select()
      .from(schema.quizzerIdentities)
      .where(eq(schema.quizzerIdentities.id, aliceId))
    expect(identity).toHaveLength(1)

    const body = await res.json<{ unassigned: Array<{ quizzerId: number; name: string }> }>()
    expect(body.unassigned).toHaveLength(1)
    expect(body.unassigned[0]!.quizzerId).toBe(aliceId)
  })

  it('drops new unassigned quizzers with negative tempId silently', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)

    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [],
        unassigned: [{ id: -1, name: 'Ghost' }],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{ unassigned: unknown[] }>()
    expect(body.unassigned).toHaveLength(0)
  })

  it('preserves quizzer order from payload in response', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const team = await seedTeam(db, meet.id, church.id, 'Open')
    const aliceId = await seedQuizzer(db, team.id, 'Alice')
    const bobId = await seedQuizzer(db, team.id, 'Bob')

    // Send Bob before Alice
    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({
        teams: [
          {
            id: team.id,
            division: 'Open',
            quizzers: [
              { id: bobId, name: 'Bob' },
              { id: aliceId, name: 'Alice' },
            ],
          },
        ],
        unassigned: [],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = await res.json<{
      teams: Array<{ quizzers: Array<{ quizzerId: number }> }>
    }>()
    expect(body.teams[0]!.quizzers[0]!.quizzerId).toBe(bobId)
    expect(body.teams[0]!.quizzers[1]!.quizzerId).toBe(aliceId)
  })

  it('cascade-deletes quizzers when their team is deleted', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id)
    const team = await seedTeam(db, meet.id, church.id, 'Open')
    const aliceId = await seedQuizzer(db, team.id, 'Alice')

    // Send empty teams (deletes the team)
    const res = await app.request(
      `/api/churches/${church.id}/roster/sync`,
      syncBody({ teams: [], unassigned: [] }),
      env,
    )
    expect(res.status).toBe(200)

    // Both roster entry and identity should be gone
    const rosters = await db.select().from(schema.teamRosters)
    expect(rosters).toHaveLength(0)
    const identities = await db
      .select()
      .from(schema.quizzerIdentities)
      .where(eq(schema.quizzerIdentities.id, aliceId))
    expect(identities).toHaveLength(0)
  })

  it('returns 404 for unknown church', async () => {
    const app = createApp(testSuperuser, db)

    const res = await app.request(
      '/api/churches/9999/roster/sync',
      syncBody({ teams: [], unassigned: [] }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---- Roster import ----

type ImportEntry = { church: string; division: string; teamName: string; quizzerName: string }

function importBody(entries: ImportEntry[]) {
  return {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
  }
}

describe('POST /api/meets/:meetId/roster/import', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('requires admin or superuser', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([{ church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' }]),
      env,
    )
    expect(res.status).toBe(403)
  })

  it('creates churches, teams, and quizzers from scratch', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' },
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Bob' },
        { church: 'First Baptist', division: 'Teen', teamName: 'Hawks', quizzerName: 'Carol' },
      ]),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{
      churchesCreated: number
      teamsCreated: number
      quizzersAdded: number
    }>()
    expect(body.churchesCreated).toBe(2)
    expect(body.teamsCreated).toBe(2)
    expect(body.quizzersAdded).toBe(3)

    const churches = await db
      .select()
      .from(schema.churches)
      .where(eq(schema.churches.meetId, meet.id))
    expect(churches).toHaveLength(2)

    const teams = await db.select().from(schema.teams).where(eq(schema.teams.meetId, meet.id))
    expect(teams).toHaveLength(2)

    const rosters = await db.select().from(schema.teamRosters)
    expect(rosters).toHaveLength(3)
  })

  it('reuses existing church matched by name (case-insensitive)', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    await seedChurch(db, meet.id, 'Grace Church')

    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([
        { church: 'grace church', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' },
      ]),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ churchesCreated: number }>()
    expect(body.churchesCreated).toBe(0)

    const churches = await db
      .select()
      .from(schema.churches)
      .where(eq(schema.churches.meetId, meet.id))
    expect(churches).toHaveLength(1)
  })

  it('reuses existing church matched by shortName', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const hash = await hashCode(generateCode())
    await db.insert(schema.churches).values({
      meetId: meet.id,
      name: 'Grace Community Church',
      shortName: 'GCC',
      coachCodeHash: hash,
    })

    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([{ church: 'GCC', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' }]),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ churchesCreated: number }>()
    expect(body.churchesCreated).toBe(0)
  })

  it('deduplicates quizzer names within a team group', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' },
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' },
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Bob' },
      ]),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ quizzersAdded: number }>()
    expect(body.quizzersAdded).toBe(2)
  })

  it('groups same church+division+teamName into one team', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)

    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' },
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Bob' },
      ]),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ teamsCreated: number; quizzersAdded: number }>()
    expect(body.teamsCreated).toBe(1)
    expect(body.quizzersAdded).toBe(2)
  })

  it('admin with membership can import', async () => {
    const app = createApp(testUser, db)
    const meet = await seedMeet(db)
    await seedAdminMembership(db, testUser.id, meet.id)

    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([{ church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' }]),
      env,
    )
    expect(res.status).toBe(201)
  })

  it('rejects empty array with 400', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)

    const res = await app.request(`/api/meets/${meet.id}/roster/import`, importBody([]), env)
    expect(res.status).toBe(400)
  })

  it('skips a team whose (division, quizzer-set) exactly matches an existing team', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, 'Grace')
    const team = await seedTeam(db, meet.id, church.id, 'Open')
    await seedQuizzer(db, team.id, 'Alice')
    await seedQuizzer(db, team.id, 'Bob')

    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' },
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Bob' },
      ]),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ teamsCreated: number; quizzersAdded: number }>()
    expect(body.teamsCreated).toBe(0)
    expect(body.quizzersAdded).toBe(0)

    const teams = await db.select().from(schema.teams).where(eq(schema.teams.churchId, church.id))
    expect(teams).toHaveLength(1)
  })

  it('does not skip a team whose quizzer set differs (subset)', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, 'Grace')
    const team = await seedTeam(db, meet.id, church.id, 'Open')
    await seedQuizzer(db, team.id, 'Alice')
    await seedQuizzer(db, team.id, 'Bob')

    // Import has same two plus Carol — not identical, so creates a new team
    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' },
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Bob' },
        { church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Carol' },
      ]),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ teamsCreated: number }>()
    expect(body.teamsCreated).toBe(1)
  })

  it('does not skip when division differs', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, 'Grace')
    const team = await seedTeam(db, meet.id, church.id, 'Open')
    await seedQuizzer(db, team.id, 'Alice')
    await seedQuizzer(db, team.id, 'Bob')

    // Same quizzers, different division
    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([
        { church: 'Grace', division: 'Teen', teamName: 'Eagles', quizzerName: 'Alice' },
        { church: 'Grace', division: 'Teen', teamName: 'Eagles', quizzerName: 'Bob' },
      ]),
      env,
    )
    expect(res.status).toBe(201)
    const body = await res.json<{ teamsCreated: number }>()
    expect(body.teamsCreated).toBe(1)
  })

  it('auto-increments team numbers per church', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, 'Grace')
    await seedTeam(db, meet.id, church.id, 'Open') // existing team number 1

    const res = await app.request(
      `/api/meets/${meet.id}/roster/import`,
      importBody([{ church: 'Grace', division: 'Open', teamName: 'Eagles', quizzerName: 'Alice' }]),
      env,
    )
    expect(res.status).toBe(201)

    const teams = await db.select().from(schema.teams).where(eq(schema.teams.churchId, church.id))
    expect(teams).toHaveLength(2)
    expect(teams.map((t) => t.number).sort()).toEqual([1, 2])
  })
})

// ---- Roster export ----

describe('GET /api/meets/:meetId/roster/export', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('requires auth', async () => {
    const app = createApp(null, db)
    const meet = await seedMeet(db)
    const res = await app.request(`/api/meets/${meet.id}/roster/export`, {}, env)
    expect(res.status).toBe(401)
  })

  it('returns empty entries when meet has no teams', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    await seedChurch(db, meet.id)

    const res = await app.request(`/api/meets/${meet.id}/roster/export`, {}, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ entries: unknown[] }>()
    expect(body.entries).toHaveLength(0)
  })

  it('returns one row per quizzer with church, team, and division fields', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const church = await seedChurch(db, meet.id, 'Grace Church')
    const team = await seedTeam(db, meet.id, church.id, 'Open')
    await seedQuizzer(db, team.id, 'Alice')
    await seedQuizzer(db, team.id, 'Bob')

    const res = await app.request(`/api/meets/${meet.id}/roster/export`, {}, env)
    expect(res.status).toBe(200)
    const body = await res.json<{
      entries: Array<{
        churchId: number
        churchName: string
        churchShortName: string
        teamId: number
        teamNumber: number
        division: string
        quizzerName: string
      }>
    }>()
    expect(body.entries).toHaveLength(2)
    expect(body.entries.every((e) => e.churchName === 'Grace Church')).toBe(true)
    expect(body.entries.every((e) => e.division === 'Open')).toBe(true)
    expect(body.entries.every((e) => e.teamNumber === 1)).toBe(true)
    expect(body.entries.map((e) => e.quizzerName).sort()).toEqual(['Alice', 'Bob'])
  })

  it('covers multiple churches and teams', async () => {
    const app = createApp(testSuperuser, db)
    const meet = await seedMeet(db)
    const grace = await seedChurch(db, meet.id, 'Grace')
    const fbc = await seedChurch(db, meet.id, 'First Baptist')
    const t1 = await seedTeam(db, meet.id, grace.id, 'Open')
    const t2 = await seedTeam(db, meet.id, fbc.id, 'Teen')
    await seedQuizzer(db, t1.id, 'Alice')
    await seedQuizzer(db, t2.id, 'Bob')

    const res = await app.request(`/api/meets/${meet.id}/roster/export`, {}, env)
    expect(res.status).toBe(200)
    const body = await res.json<{ entries: Array<{ churchName: string; quizzerName: string }> }>()
    expect(body.entries).toHaveLength(2)
    const names = body.entries.map((e) => e.quizzerName).sort()
    expect(names).toEqual(['Alice', 'Bob'])
    const churches = [...new Set(body.entries.map((e) => e.churchName))].sort()
    expect(churches).toEqual(['First Baptist', 'Grace'])
  })
})
