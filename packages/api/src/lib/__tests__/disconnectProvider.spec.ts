import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  accountRequest,
  ageSessions,
  createAuthTestApp,
  postAuth,
  providerLink,
  providersOf,
  TEST_PASSWORD as PASSWORD,
  verifiedAccount,
  type AuthTestApp,
} from '../../test-utils'

/** A verified password account with GitHub connected from settings. */
async function withGitHub(test: AuthTestApp, email: string) {
  const account = await verifiedAccount(test, email)
  await providerLink(test, account.cookie, 'github', { id: '21', email, verified: true })
  return account
}

const disconnect = (test: AuthTestApp, cookie: string, body: unknown) =>
  accountRequest(test, 'disconnect', cookie, body)

const sessionsOf = async (test: AuthTestApp, userId: string) =>
  test.db.select().from(schema.session).where(eq(schema.session.userId, userId))

describe('disconnecting a provider from settings', () => {
  it('disconnects with the password and ends every other session', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await withGitHub(test, 'coach@example.com')
    await postAuth(test, 'sign-in/email', { email: 'coach@example.com', password: PASSWORD })
    expect(await sessionsOf(test, userId)).toHaveLength(2)

    const res = await disconnect(test, cookie, { provider: 'github', password: PASSWORD })

    expect(res.status).toBe(200)
    expect(await providersOf(test, userId)).toEqual(['credential'])
    const left = await sessionsOf(test, userId)
    expect(left).toHaveLength(1)
    expect(cookie).toContain(left[0]!.token)
  })

  it('refuses a wrong password', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await withGitHub(test, 'wrong@example.com')

    const res = await disconnect(test, cookie, { provider: 'github', password: 'not-it-at-all' })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'INVALID_PASSWORD' })
    expect(await providersOf(test, userId)).toContain('github')
  })

  it('asks for a sign-in within the last day', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await withGitHub(test, 'stale@example.com')
    await ageSessions(test, userId)

    const res = await disconnect(test, cookie, { provider: 'github', password: PASSWORD })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'SESSION_NOT_FRESH' })
    expect(await providersOf(test, userId)).toContain('github')
  })

  it('keeps a provider that is the only way in', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await withGitHub(test, 'nopass@example.com')
    await test.db.delete(schema.account).where(eq(schema.account.providerId, 'credential'))

    const res = await disconnect(test, cookie, { provider: 'github', password: PASSWORD })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' })
    expect(await providersOf(test, userId)).toEqual(['github'])
  })

  it('needs a sign-in', async () => {
    const test = await createAuthTestApp()
    const res = await disconnect(test, '', { provider: 'github', password: PASSWORD })
    expect(res.status).toBe(401)
  })

  it("leaves Better Auth's own unlink route off", async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await withGitHub(test, 'unlink@example.com')

    const res = await postAuth(test, 'unlink-account', { providerId: 'github' }, cookie)

    expect(res.status).toBe(404)
    expect(await providersOf(test, userId)).toContain('github')
  })

  it('limits password guesses', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await withGitHub(test, 'guessed@example.com')
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await disconnect(test, cookie, { provider: 'github', password: `guess-${i}` })
      statuses.push(res.status)
    }

    expect(statuses.slice(0, 5)).toEqual([403, 403, 403, 403, 403])
    expect(statuses[5]).toBe(429)
    expect(await providersOf(test, userId)).toContain('github')
  })

  it("refuses a provider the account doesn't have, signing nobody out", async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await withGitHub(test, 'stale@example.com')
    await postAuth(test, 'sign-in/email', { email: 'stale@example.com', password: PASSWORD })

    const res = await disconnect(test, cookie, { provider: 'google', password: PASSWORD })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'NOT_CONNECTED' })
    expect(await sessionsOf(test, userId)).toHaveLength(2)
  })
})
