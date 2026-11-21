import { describe, it, expect } from 'vitest'
import * as schema from '../../db/schema'
import { createAuthTestApp, signUpWithPassword } from '../../test-utils'
import { withoutCachedSession } from '../session'

// The session's cached copy (`session.cookieCache` in lib/auth.ts), trusted only by requests that read

async function endedElsewhere() {
  const test = await createAuthTestApp()
  test.app.on(['GET', 'POST'], '/api/who', (c) => c.json({ user: c.get('user')?.id ?? null }))
  const { cookie, userId } = await signUpWithPassword(test, 'cached@example.com')
  // Ended elsewhere, say by a password reset, while this device still holds the copy
  await test.db.delete(schema.session)
  const who = async (method: string) => {
    const res = await test.app.request('/api/who', { method, headers: { cookie } })
    // Refused as signed out before reaching the route, where a request needs an account
    if (res.status === 401) return null
    return ((await res.json()) as { user: string | null }).user
  }
  return { test, cookie, userId, who }
}

describe("the session's cached copy", () => {
  it('lets a read go on for the minute the copy lasts', async () => {
    const { userId, who } = await endedElsewhere()
    expect(await who('GET')).toBe(userId)
  })

  it('is never trusted to change anything', async () => {
    const { who } = await endedElsewhere()
    expect(await who('POST')).toBeNull()
  })

  it("is never trusted by Better Auth's own routes, so the app sees the session end at once", async () => {
    const { test, cookie } = await endedElsewhere()
    const res = await test.app.request('/api/auth/get-session', { headers: { cookie } })
    expect(await res.json()).toBeNull()
  })
})

describe('withoutCachedSession', () => {
  it('drops the cached copy, chunked or prefixed, and keeps every other cookie', () => {
    const headers = new Headers({
      cookie: 'qzr.session_token=t; qzr.session_data=d; __Secure-qzr.session_data.0=c; theme=dark',
    })
    expect(withoutCachedSession(headers).get('cookie')).toBe('qzr.session_token=t; theme=dark')
  })
})
