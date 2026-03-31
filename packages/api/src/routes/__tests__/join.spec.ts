import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Bindings } from '../../bindings'
import type { JoinVariables } from '../join'
import { join } from '../join'
import { mockSession, mockDb, testSuperuser, testUser, jsonOf } from '../../test-utils'

import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'
import { generateCode, hashCode } from '../../lib/codes'
import { verifyGuestJwt } from '../../lib/jwt'
import * as schema from '../../db/schema'
import { MeetRole } from '@qzr/shared'

const env = {
  ENVIRONMENT: 'test',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
} as unknown as Bindings

function createApp(user: typeof testSuperuser | typeof testUser | null, db: Db) {
  const app = new Hono<{ Bindings: Bindings; Variables: JoinVariables }>()
  app.use('*', mockSession(user))
  app.use('*', mockDb(db))
  app.route('/api/join', join)
  return app
}

function post(body: Record<string, unknown>) {
  return {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function seedMeet(
  db: Db,
  opts: { name?: string; viewerCode?: string; adminCode?: string } = {},
) {
  const adminCode = opts.adminCode ?? generateCode()
  const adminHash = await hashCode(adminCode)

  const [meet] = await db
    .insert(schema.quizMeets)
    .values({
      name: opts.name ?? 'Test Meet',
      dateFrom: '2025-06-01',
      dateTo: '2025-06-02',
      viewerCode: opts.viewerCode ?? 'test-viewer',
      adminCodeHash: adminHash,
      createdAt: new Date(),
    })
    .returning()

  return { meet: meet!, adminCode }
}

async function seedChurch(db: Db, meetId: number, coachCode?: string) {
  const code = coachCode ?? generateCode()
  const hash = await hashCode(code)
  const [church] = await db
    .insert(schema.churches)
    .values({ meetId, name: 'Test Church', shortName: 'TC', coachCodeHash: hash })
    .returning()
  return { church: church!, coachCode: code }
}

async function seedOfficialCode(db: Db, meetId: number, label: string) {
  const code = generateCode()
  const codeHash = await hashCode(code)

  const [row] = await db
    .insert(schema.officialCodes)
    .values({ meetId, label, codeHash })
    .returning()

  return { officialCode: row!, code }
}

type JoinBody = { meet: { id: number; name: string }; role: string; label?: string; token?: string }

describe('POST /api/join', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testUser, db)
  })

  it('rejects unauthenticated requests with 401', async () => {
    const unauthApp = createApp(null, db)
    const res = await unauthApp.request('/api/join', post({ code: 'anything' }), env)
    expect(res.status).toBe(401)
  })

  it('rejects missing code with 400', async () => {
    const res = await app.request('/api/join', post({}), env)
    expect(res.status).toBe(400)
  })

  it('rejects empty code with 400', async () => {
    const res = await app.request('/api/join', post({ code: '   ' }), env)
    expect(res.status).toBe(400)
  })

  it('returns 404 for invalid code', async () => {
    const res = await app.request('/api/join', post({ code: 'nonexistent' }), env)
    expect(res.status).toBe(404)
  })

  describe('viewer codes', () => {
    it('joins as viewer with the viewer code slug', async () => {
      const { meet } = await seedMeet(db, { viewerCode: 'fall-2025' })

      const res = await app.request('/api/join', post({ code: 'fall-2025' }), env)
      expect(res.status).toBe(200)

      const body = await jsonOf<JoinBody>(res)
      expect(body.meet.id).toBe(meet.id)
      expect(body.meet.name).toBe('Test Meet')
      expect(body.role).toBe(MeetRole.Viewer)
    })

    it('is idempotent — joining twice does not duplicate membership', async () => {
      await seedMeet(db, { viewerCode: 'slug' })

      await app.request('/api/join', post({ code: 'slug' }), env)
      const res = await app.request('/api/join', post({ code: 'slug' }), env)
      expect(res.status).toBe(200)

      const rows = await db.select().from(schema.viewerMemberships)
      expect(rows).toHaveLength(1)
    })
  })

  describe('admin codes', () => {
    it('joins as admin with the admin code', async () => {
      const { meet, adminCode } = await seedMeet(db)

      const res = await app.request('/api/join', post({ code: adminCode }), env)
      expect(res.status).toBe(200)

      const body = await jsonOf<JoinBody>(res)
      expect(body.meet.id).toBe(meet.id)
      expect(body.role).toBe(MeetRole.Admin)
    })

    it('is idempotent', async () => {
      const { adminCode } = await seedMeet(db)

      await app.request('/api/join', post({ code: adminCode }), env)
      await app.request('/api/join', post({ code: adminCode }), env)

      const rows = await db.select().from(schema.adminMemberships)
      expect(rows).toHaveLength(1)
    })
  })

  describe('coach codes', () => {
    it('joins as head_coach with a church coach code', async () => {
      const { meet } = await seedMeet(db)
      const { coachCode } = await seedChurch(db, meet.id)

      const res = await app.request('/api/join', post({ code: coachCode }), env)
      expect(res.status).toBe(200)

      const body = await jsonOf<JoinBody>(res)
      expect(body.meet.id).toBe(meet.id)
      expect(body.role).toBe(MeetRole.HeadCoach)
    })

    it('is idempotent', async () => {
      const { meet } = await seedMeet(db)
      const { coachCode } = await seedChurch(db, meet.id)

      await app.request('/api/join', post({ code: coachCode }), env)
      await app.request('/api/join', post({ code: coachCode }), env)

      const rows = await db.select().from(schema.coachMemberships)
      expect(rows).toHaveLength(1)
    })
  })

  describe('official codes', () => {
    it('joins as official with a room code', async () => {
      const { meet } = await seedMeet(db)
      const { code } = await seedOfficialCode(db, meet.id, 'Room A')

      const res = await app.request('/api/join', post({ code }), env)
      expect(res.status).toBe(200)

      const body = await jsonOf<JoinBody>(res)
      expect(body.meet.id).toBe(meet.id)
      expect(body.role).toBe(MeetRole.Official)
      expect(body.label).toBe('Room A')
    })

    it('is idempotent', async () => {
      const { meet } = await seedMeet(db)
      const { code } = await seedOfficialCode(db, meet.id, 'Room A')

      await app.request('/api/join', post({ code }), env)
      await app.request('/api/join', post({ code }), env)

      const rows = await db.select().from(schema.officialMemberships)
      expect(rows).toHaveLength(1)
    })

    it('can join multiple rooms in the same meet', async () => {
      const { meet } = await seedMeet(db)
      const { code: codeA } = await seedOfficialCode(db, meet.id, 'Room A')
      const { code: codeB } = await seedOfficialCode(db, meet.id, 'Room B')

      await app.request('/api/join', post({ code: codeA }), env)
      await app.request('/api/join', post({ code: codeB }), env)

      const rows = await db.select().from(schema.officialMemberships)
      expect(rows).toHaveLength(2)
    })
  })

  describe('priority', () => {
    it('viewer code takes precedence when a slug matches before hash lookup', async () => {
      // If a viewer code slug happens to be the same string as another code,
      // viewer match wins (checked first)
      const viewerSlug = 'special-code'
      await seedMeet(db, { viewerCode: viewerSlug })

      const res = await app.request('/api/join', post({ code: viewerSlug }), env)
      expect(res.status).toBe(200)

      const body = await jsonOf<JoinBody>(res)
      expect(body.role).toBe(MeetRole.Viewer)
    })
  })
})

describe('POST /api/join/guest', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    // Guest endpoint doesn't require auth — pass null
    app = createApp(null, db)
  })

  it('rejects missing code with 400', async () => {
    const res = await app.request('/api/join/guest', post({}), env)
    expect(res.status).toBe(400)
  })

  it('returns 404 for invalid code', async () => {
    const res = await app.request('/api/join/guest', post({ code: 'nope' }), env)
    expect(res.status).toBe(404)
  })

  it('does not accept admin codes', async () => {
    const { adminCode } = await seedMeet(db)
    const res = await app.request('/api/join/guest', post({ code: adminCode }), env)
    expect(res.status).toBe(404)
  })

  it('does not accept coach codes', async () => {
    const { meet } = await seedMeet(db)
    const { coachCode } = await seedChurch(db, meet.id)
    const res = await app.request('/api/join/guest', post({ code: coachCode }), env)
    expect(res.status).toBe(404)
  })

  describe('viewer guest session', () => {
    it('returns a guest JWT for a viewer code', async () => {
      const { meet } = await seedMeet(db, { viewerCode: 'public-slug' })

      const res = await app.request('/api/join/guest', post({ code: 'public-slug' }), env)
      expect(res.status).toBe(200)

      const body = await jsonOf<JoinBody>(res)
      expect(body.token).toBeTypeOf('string')
      expect(body.meet.id).toBe(meet.id)
      expect(body.role).toBe(MeetRole.Viewer)

      // Verify the JWT
      const payload = await verifyGuestJwt(body.token!, 'test-secret-at-least-32-characters-long')
      expect(payload).not.toBeNull()
      expect(payload!.meetId).toBe(meet.id)
      expect(payload!.role).toBe(MeetRole.Viewer)
    })
  })

  describe('official guest session', () => {
    it('returns a guest JWT for an official code', async () => {
      const { meet } = await seedMeet(db)
      const { code } = await seedOfficialCode(db, meet.id, 'Room B')

      const res = await app.request('/api/join/guest', post({ code }), env)
      expect(res.status).toBe(200)

      const body = await jsonOf<JoinBody>(res)
      expect(body.token).toBeTypeOf('string')
      expect(body.meet.id).toBe(meet.id)
      expect(body.role).toBe(MeetRole.Official)
      expect(body.label).toBe('Room B')

      const payload = await verifyGuestJwt(body.token!, 'test-secret-at-least-32-characters-long')
      expect(payload).not.toBeNull()
      expect(payload!.meetId).toBe(meet.id)
      expect(payload!.role).toBe(MeetRole.Official)
      expect(payload!.label).toBe('Room B')
    })
  })
})
