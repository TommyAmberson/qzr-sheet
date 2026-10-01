import { describe, it, expect } from 'vitest'
import { app } from '../../index'
import { jsonRequest, testBindings as env } from '../../test-utils'

/**
 * The API is served at both `/api/*` and `/qzr/api/*` while qzr moves under
 * `/qzr/` (specs/001-qzr-subpath). The same handlers and middleware must answer
 * on both prefixes.
 */

async function snapshot(res: Response) {
  return { status: res.status, body: await res.text() }
}

describe('/qzr prefix', () => {
  it.each([
    ['/api/meets', undefined, 401],
    ['/api/join/guest', () => jsonRequest('POST', { code: '  ' }), 400],
    ['/health', undefined, 200],
  ] as const)('answers /qzr%s like %s', async (path, init, status) => {
    const root = await snapshot(await app.request(path, init?.(), env))
    const prefixed = await snapshot(await app.request(`/qzr${path}`, init?.(), env))
    expect(root.status).toBe(status)
    expect(prefixed).toEqual(root)
  })

  it('returns 404 for an unknown path under /qzr', async () => {
    const res = await app.request('/qzr/does-not-exist', {}, env)
    expect(res.status).toBe(404)
  })
})
