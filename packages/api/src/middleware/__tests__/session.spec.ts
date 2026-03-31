import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { Bindings } from '../../bindings'
import type { SessionVariables } from '../session'
import { requireAuth, requireSuperuser } from '../session'
import { mockSession, testSuperuser, testUser, jsonOf } from '../../test-utils'

// Minimal env stub
const env = { ENVIRONMENT: 'test' } as unknown as Bindings

function createApp(user: import('../session').SessionUser | null) {
  const app = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>()
  app.use('*', mockSession(user))
  app.use('/auth/*', requireAuth())
  app.use('/superuser/*', requireAuth(), requireSuperuser())
  app.get('/public', (c) => c.json({ ok: true }))
  app.get('/auth/profile', (c) => c.json({ user: c.get('user') }))
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
