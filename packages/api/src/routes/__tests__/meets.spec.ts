import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Bindings } from '../../bindings'
import type { MeetsVariables } from '../meets'
import { meets } from '../meets'
import { mockSession, mockDb, testSuperuser, testUser, jsonOf } from '../../test-utils'
import { createTestDb } from '../../test-db'
import type { Db } from '../../lib/db'

const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(user: typeof testSuperuser | typeof testUser | null, db: Db) {
  const app = new Hono<{ Bindings: Bindings; Variables: MeetsVariables }>()
  app.use('*', mockSession(user))
  app.use('*', mockDb(db))
  app.route('/api/meets', meets)
  return app
}

function json(body: Record<string, unknown>) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function patch(body: Record<string, unknown>) {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

type MeetBody = {
  meet: {
    id: number
    name: string
    dateFrom: string
    dateTo: string | null
    viewerCode: string
    divisions: string[]
  }
  adminCode?: string
}
type MeetsBody = { meets: MeetBody['meet'][] }
type MeetDetailBody = { meet: MeetBody['meet']; officialCodes: { id: number; label: string }[] }
type OfficialCodeBody = { officialCode: { id: number; label: string }; code: string }
type AdminCodeBody = { adminCode: string }

describe('meet CRUD', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  describe('POST /api/meets', () => {
    it('creates a meet and returns the admin code', async () => {
      const res = await app.request(
        '/api/meets',
        json({
          name: 'Fall Classic',
          dateFrom: '2025-10-14',
          dateTo: '2025-10-15',
          viewerCode: 'fall-2025',
          divisions: ['Div 1', 'Div 2'],
        }),
        env,
      )
      expect(res.status).toBe(201)
      const body = await jsonOf<MeetBody>(res)
      expect(body.meet.name).toBe('Fall Classic')
      expect(body.meet.dateFrom).toBe('2025-10-14')
      expect(body.meet.dateTo).toBe('2025-10-15')
      expect(body.meet.viewerCode).toBe('fall-2025')
      expect(body.meet.id).toBeTypeOf('number')
      expect(body.adminCode).toBeTypeOf('string')
      expect(body.adminCode!.length).toBeGreaterThanOrEqual(16)
    })

    it('rejects missing fields with 400', async () => {
      const res = await app.request('/api/meets', json({ name: 'No date' }), env)
      expect(res.status).toBe(400)
    })

    it('trims whitespace from fields', async () => {
      const res = await app.request(
        '/api/meets',
        json({
          name: '  Trimmed  ',
          dateFrom: ' 2025-01-01 ',
          dateTo: ' 2025-01-02 ',
          viewerCode: ' slug ',
          divisions: ['Div 1'],
        }),
        env,
      )
      expect(res.status).toBe(201)
      const body = await jsonOf<MeetBody>(res)
      expect(body.meet.name).toBe('Trimmed')
      expect(body.meet.dateFrom).toBe('2025-01-01')
      expect(body.meet.dateTo).toBe('2025-01-02')
      expect(body.meet.viewerCode).toBe('slug')
    })
  })

  describe('GET /api/meets', () => {
    it('returns an empty list initially', async () => {
      const res = await app.request('/api/meets', {}, env)
      expect(res.status).toBe(200)
      const body = await jsonOf<MeetsBody>(res)
      expect(body.meets).toEqual([])
    })

    it('returns created meets', async () => {
      await app.request(
        '/api/meets',
        json({
          name: 'Meet 1',
          dateFrom: '2025-01-01',
          dateTo: '2025-01-02',
          viewerCode: 'v1',
          divisions: ['Div 1'],
        }),
        env,
      )
      await app.request(
        '/api/meets',
        json({
          name: 'Meet 2',
          dateFrom: '2025-02-01',
          dateTo: '2025-02-02',
          viewerCode: 'v2',
          divisions: ['Div 1'],
        }),
        env,
      )

      const res = await app.request('/api/meets', {}, env)
      const body = await jsonOf<MeetsBody>(res)
      expect(body.meets).toHaveLength(2)
      expect(body.meets.map((m: { name: string }) => m.name)).toContain('Meet 1')
      expect(body.meets.map((m: { name: string }) => m.name)).toContain('Meet 2')
    })
  })

  describe('GET /api/meets/:id', () => {
    it('returns a meet with its official codes', async () => {
      const createRes = await app.request(
        '/api/meets',
        json({
          name: 'Detail Meet',
          dateFrom: '2025-03-01',
          dateTo: '2025-03-02',
          viewerCode: 'dm',
          divisions: ['Div 1'],
        }),
        env,
      )
      const { meet } = (await createRes.json()) as MeetBody

      const res = await app.request(`/api/meets/${meet.id}`, {}, env)
      expect(res.status).toBe(200)
      const body = await jsonOf<MeetDetailBody>(res)
      expect(body.meet.name).toBe('Detail Meet')
      expect(body.officialCodes).toEqual([])
    })

    it('returns 404 for non-existent meet', async () => {
      const res = await app.request('/api/meets/9999', {}, env)
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/meets/:id', () => {
    it('updates meet fields', async () => {
      const createRes = await app.request(
        '/api/meets',
        json({
          name: 'Old',
          dateFrom: '2025-01-01',
          dateTo: '2025-01-02',
          viewerCode: 'old',
          divisions: ['Div 1'],
        }),
        env,
      )
      const { meet } = (await createRes.json()) as MeetBody

      const res = await app.request(`/api/meets/${meet.id}`, patch({ name: 'New Name' }), env)
      expect(res.status).toBe(200)
      const body = await jsonOf<MeetBody>(res)
      expect(body.meet.name).toBe('New Name')
      expect(body.meet.dateFrom).toBe('2025-01-01')
    })

    it('returns 404 for non-existent meet', async () => {
      const res = await app.request('/api/meets/9999', patch({ name: 'X' }), env)
      expect(res.status).toBe(404)
    })

    it('rejects empty update with 400', async () => {
      const res = await app.request('/api/meets/1', patch({}), env)
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/meets/:id', () => {
    it('deletes an existing meet', async () => {
      const createRes = await app.request(
        '/api/meets',
        json({
          name: 'To Delete',
          dateFrom: '2025-01-01',
          dateTo: '2025-01-02',
          viewerCode: 'del',
          divisions: ['Div 1'],
        }),
        env,
      )
      const { meet } = (await createRes.json()) as MeetBody

      const res = await app.request(`/api/meets/${meet.id}`, { method: 'DELETE' }, env)
      expect(res.status).toBe(200)

      const getRes = await app.request(`/api/meets/${meet.id}`, {}, env)
      expect(getRes.status).toBe(404)
    })

    it('returns 404 for non-existent meet', async () => {
      const res = await app.request('/api/meets/9999', { method: 'DELETE' }, env)
      expect(res.status).toBe(404)
    })
  })
})

describe('admin code rotation', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)
  })

  it('returns a new admin code', async () => {
    const createRes = await app.request(
      '/api/meets',
      json({
        name: 'Rotate Test',
        dateFrom: '2025-01-01',
        dateTo: '2025-01-02',
        viewerCode: 'rt',
        divisions: ['Div 1'],
      }),
      env,
    )
    const { meet, adminCode: oldCode } = (await createRes.json()) as MeetBody

    const res = await app.request(
      `/api/meets/${meet.id}/rotate-admin-code`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env,
    )
    expect(res.status).toBe(200)
    const body = await jsonOf<AdminCodeBody>(res)
    expect(body.adminCode).toBeTypeOf('string')
    expect(body.adminCode).not.toBe(oldCode)
  })

  it('returns 404 for non-existent meet', async () => {
    const res = await app.request(
      '/api/meets/9999/rotate-admin-code',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env,
    )
    expect(res.status).toBe(404)
  })

  it('admin can rotate but cannot clear members', async () => {
    const adminApp = createApp(testUser, db)
    const createRes = await app.request(
      '/api/meets',
      json({
        name: 'Admin Clear Test',
        dateFrom: '2025-01-01',
        viewerCode: 'act',
        divisions: ['Div 1'],
      }),
      env,
    )
    const { meet } = (await createRes.json()) as MeetBody

    // Give testUser admin membership
    const { adminMemberships } = await import('../../db/schema')
    await db.insert(adminMemberships).values({ accountId: testUser.id, meetId: meet.id })

    // Rotate without clear — should succeed
    const rotateRes = await adminApp.request(
      `/api/meets/${meet.id}/rotate-admin-code`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env,
    )
    expect(rotateRes.status).toBe(200)

    // Rotate with clearMembers — should be rejected
    const clearRes = await adminApp.request(
      `/api/meets/${meet.id}/rotate-admin-code`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearMembers: true }),
      },
      env,
    )
    expect(clearRes.status).toBe(403)
  })
})

describe('official codes', () => {
  let db: Db
  let app: ReturnType<typeof createApp>
  let meetId: number

  beforeEach(async () => {
    db = await createTestDb()
    app = createApp(testSuperuser, db)

    const createRes = await app.request(
      '/api/meets',
      json({
        name: 'Official Test',
        dateFrom: '2025-01-01',
        dateTo: '2025-01-02',
        viewerCode: 'ot',
        divisions: ['Div 1'],
      }),
      env,
    )
    const { meet } = (await createRes.json()) as MeetBody
    meetId = meet.id
  })

  describe('POST /api/meets/:id/official-codes', () => {
    it('creates an official code and returns the plaintext', async () => {
      const res = await app.request(
        `/api/meets/${meetId}/official-codes`,
        json({ label: 'Room A' }),
        env,
      )
      expect(res.status).toBe(201)
      const body = await jsonOf<OfficialCodeBody>(res)
      expect(body.officialCode.label).toBe('Room A')
      expect(body.officialCode.id).toBeTypeOf('number')
      expect(body.code).toBeTypeOf('string')
    })

    it('rejects missing label with 400', async () => {
      const res = await app.request(`/api/meets/${meetId}/official-codes`, json({}), env)
      expect(res.status).toBe(400)
    })

    it('returns 404 for non-existent meet', async () => {
      const res = await app.request(
        '/api/meets/9999/official-codes',
        json({ label: 'Room X' }),
        env,
      )
      expect(res.status).toBe(404)
    })

    it('shows official codes in meet detail', async () => {
      await app.request(`/api/meets/${meetId}/official-codes`, json({ label: 'Room A' }), env)
      await app.request(`/api/meets/${meetId}/official-codes`, json({ label: 'Room B' }), env)

      const res = await app.request(`/api/meets/${meetId}`, {}, env)
      const body = await jsonOf<MeetDetailBody>(res)
      expect(body.officialCodes).toHaveLength(2)
      const labels = body.officialCodes.map((c) => c.label)
      expect(labels).toContain('Room A')
      expect(labels).toContain('Room B')
    })
  })

  describe('DELETE /api/meets/:id/official-codes/:codeId', () => {
    it('deletes an official code', async () => {
      const createRes = await app.request(
        `/api/meets/${meetId}/official-codes`,
        json({ label: 'Room A' }),
        env,
      )
      const { officialCode } = (await createRes.json()) as OfficialCodeBody

      const res = await app.request(
        `/api/meets/${meetId}/official-codes/${officialCode.id}`,
        { method: 'DELETE' },
        env,
      )
      expect(res.status).toBe(200)

      const detailRes = await app.request(`/api/meets/${meetId}`, {}, env)
      const body = await jsonOf<MeetDetailBody>(detailRes)
      expect(body.officialCodes).toHaveLength(0)
    })
  })

  describe('POST /api/meets/:id/official-codes/:codeId/rotate', () => {
    it('returns a new code for the official code', async () => {
      const createRes = await app.request(
        `/api/meets/${meetId}/official-codes`,
        json({ label: 'Room A' }),
        env,
      )
      const { officialCode, code: oldCode } = (await createRes.json()) as OfficialCodeBody

      const res = await app.request(
        `/api/meets/${meetId}/official-codes/${officialCode.id}/rotate`,
        { method: 'POST' },
        env,
      )
      expect(res.status).toBe(200)
      const body = await jsonOf<OfficialCodeBody>(res)
      expect(body.code).toBeTypeOf('string')
      expect(body.code).not.toBe(oldCode)
      expect(body.officialCode.label).toBe('Room A')
    })
  })
})

describe('auth guards', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const db = await createTestDb()
    const app = createApp(null, db)
    const res = await app.request('/api/meets', {}, env)
    expect(res.status).toBe(401)
  })

  it('rejects non-superuser users with 403', async () => {
    const db = await createTestDb()
    const app = createApp(testUser, db)
    const res = await app.request('/api/meets', {}, env)
    expect(res.status).toBe(403)
  })
})
