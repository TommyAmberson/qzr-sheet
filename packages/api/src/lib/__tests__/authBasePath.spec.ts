import { describe, it, expect } from 'vitest'
import { app } from '../../index'
import { testBindings as env } from '../../test-utils'

// Better Auth's base path follows the mount the request came in on, so OAuth
// callbacks return to that entrance. `/ok` touches no tables.
describe('Better Auth behind both prefixes', () => {
  it.each(['/api/auth/ok', '/qzr/api/auth/ok'])('routes %s to Better Auth', async (path) => {
    const res = await app.request(path, {}, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('does not answer the root base path under /qzr', async () => {
    const res = await app.request('/qzr/api/auth/api/auth/ok', {}, env)
    expect(res.status).toBe(404)
  })
})
