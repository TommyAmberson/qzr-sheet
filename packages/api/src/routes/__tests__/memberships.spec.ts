import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Bindings } from '../../bindings'
import type { MembershipsVariables } from '../memberships'
import { memberships } from '../memberships'
import { mockSession, mockDb, testUser } from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'
import { generateCode, hashCode } from '../../lib/codes'
import * as schema from '../../db/schema'
import { MeetRole } from '@qzr/shared'

const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(user: typeof testUser | null, db: Db) {
  const app = new Hono<{ Bindings: Bindings; Variables: MembershipsVariables }>()
  app.use('*', mockSession(user))
  app.use('*', mockDb(db))
  app.route('/api/my-meets', memberships)
  return app
}

async function seedMeet(db: Db, name: string) {
  const coachCode = generateCode()
  const [meet] = await db
    .insert(schema.quizMeets)
    .values({
      name,
      date: '2025-06-01',
      viewerCode: `viewer-${name}`,
      coachCodeHash: await hashCode(coachCode),
      createdAt: new Date(),
    })
    .returning()
  return meet!
}

describe('GET /api/my-meets', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    db = createTestDb()
    app = createApp(testUser, db)
  })

  it('rejects unauthenticated requests with 401', async () => {
    const unauthApp = createApp(null, db)
    const res = await unauthApp.request('/api/my-meets', {}, env)
    expect(res.status).toBe(401)
  })

  it('returns empty list when user has no memberships', async () => {
    const res = await app.request('/api/my-meets', {}, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.memberships).toEqual([])
  })

  it('returns coach memberships', async () => {
    const meet = await seedMeet(db, 'Coach Meet')
    await db.insert(schema.coachMemberships).values({ accountId: testUser.id, meetId: meet.id })

    const res = await app.request('/api/my-meets', {}, env)
    const body = await res.json()
    expect(body.memberships).toHaveLength(1)
    expect(body.memberships[0].meetId).toBe(meet.id)
    expect(body.memberships[0].meetName).toBe('Coach Meet')
    expect(body.memberships[0].role).toBe(MeetRole.HeadCoach)
  })

  it('returns official memberships with room label', async () => {
    const meet = await seedMeet(db, 'Official Meet')
    const [code] = await db
      .insert(schema.officialCodes)
      .values({ meetId: meet.id, label: 'Room A', codeHash: await hashCode('test') })
      .returning()

    await db.insert(schema.officialMemberships).values({
      accountId: testUser.id,
      meetId: meet.id,
      officialCodeId: code!.id,
    })

    const res = await app.request('/api/my-meets', {}, env)
    const body = await res.json()
    expect(body.memberships).toHaveLength(1)
    expect(body.memberships[0].role).toBe(MeetRole.Official)
    expect(body.memberships[0].label).toBe('Room A')
  })

  it('returns viewer memberships', async () => {
    const meet = await seedMeet(db, 'Viewer Meet')
    await db.insert(schema.viewerMemberships).values({ accountId: testUser.id, meetId: meet.id })

    const res = await app.request('/api/my-meets', {}, env)
    const body = await res.json()
    expect(body.memberships).toHaveLength(1)
    expect(body.memberships[0].role).toBe(MeetRole.Viewer)
  })

  it('returns all roles across multiple meets', async () => {
    const meet1 = await seedMeet(db, 'Meet A')
    const meet2 = await seedMeet(db, 'Meet B')

    await db.insert(schema.coachMemberships).values({ accountId: testUser.id, meetId: meet1.id })
    await db.insert(schema.viewerMemberships).values({ accountId: testUser.id, meetId: meet2.id })

    const res = await app.request('/api/my-meets', {}, env)
    const body = await res.json()
    expect(body.memberships).toHaveLength(2)

    const roles = body.memberships.map((m: { role: string }) => m.role)
    expect(roles).toContain(MeetRole.HeadCoach)
    expect(roles).toContain(MeetRole.Viewer)
  })
})
