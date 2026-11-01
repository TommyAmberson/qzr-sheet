import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { Bindings } from '../../bindings'
import type { SessionVariables } from '../session'
import { requireAuth, requireSuperuser } from '../session'
import { mockSession, testSuperuser, testUser, jsonOf } from '../../test-utils'
import type { GuestPayload } from '../../lib/jwt'
import { MeetRole } from '@qzr/shared'

// Minimal env stub
const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(
  user: import('../session').SessionUser | null,
  guest: GuestPayload | null = null,
) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>()
  app.use('*', mockSession(user, guest))
  app.use('/auth/*', requireAuth())
  app.use('/api/meets/*', requireAuth())
  app.use('/qzr/api/meets/*', requireAuth())
  app.use('/superuser/*', requireAuth(), requireSuperuser())
  app.get('/public', (c) => c.json({ ok: true }))
  app.get('/auth/profile', (c) => c.json({ user: c.get('user') }))
  app.get('/api/meets/:id/schedule', (c) => c.json({ ok: true }))
  app.get('/qzr/api/meets/:id/schedule', (c) => c.json({ ok: true }))
  app.get('/superuser/dashboard', (c) => c.json({ superuser: true }))
  return app
}

describe('requireAuth', () => {
  it('allows authenticated users', async () => {
    const app = createApp(testUser)
    const res = await app.request('/auth/profile', {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ user: { id: string } }>(res)
    expect(body.user.id).toBe('user-001')
  })

  it('rejects unauthenticated requests with 401', async () => {
    const app = createApp(null)
    const res = await app.request('/auth/profile', {}, env)
    expect(res.status).toBe(401)
  })

  it('does not block public routes', async () => {
    const app = createApp(null)
    const res = await app.request('/public', {}, env)
    expect(res.status).toBe(200)
  })
})

describe('requireAuth for a guest', () => {
  const guest = { meetId: 1, role: MeetRole.Viewer, codeTag: 'tag' } as GuestPayload

  it("answers 403 on a route about the token's meet, since renewing it would not help", async () => {
    expect((await createApp(null, guest).request('/api/meets/1/schedule', {}, env)).status).toBe(
      403,
    )
  })

  it('reads the meet the same way under the /qzr mount', async () => {
    const res = await createApp(null, guest).request('/qzr/api/meets/1/schedule', {}, env)
    expect(res.status).toBe(403)
  })

  it("answers 401 on a route about another meet, where the token doesn't apply", async () => {
    expect((await createApp(null, guest).request('/api/meets/2/schedule', {}, env)).status).toBe(
      401,
    )
  })

  it('answers 401 on a route about no meet, which the apps read as not signed in', async () => {
    expect((await createApp(null, guest).request('/auth/profile', {}, env)).status).toBe(401)
  })
})

describe('requireSuperuser', () => {
  it('allows superuser users', async () => {
    const app = createApp(testSuperuser)
    const res = await app.request('/superuser/dashboard', {}, env)
    expect(res.status).toBe(200)
    const body = await jsonOf<{ superuser: boolean }>(res)
    expect(body.superuser).toBe(true)
  })

  it('rejects non-superuser users with 403', async () => {
    const app = createApp(testUser)
    const res = await app.request('/superuser/dashboard', {}, env)
    expect(res.status).toBe(403)
  })

  it('rejects unauthenticated requests with 401', async () => {
    const app = createApp(null)
    const res = await app.request('/superuser/dashboard', {}, env)
    expect(res.status).toBe(401)
  })
})
