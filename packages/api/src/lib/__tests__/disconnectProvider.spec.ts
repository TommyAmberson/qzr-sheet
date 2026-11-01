import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  codeFor,
  createAuthTestApp,
  postAuth,
  providerLink,
  signUpWithPassword,
  type AuthTestApp,
} from '../../test-utils'

const PASSWORD = 'correct-horse-battery'

/** A verified password account with GitHub connected from settings. */
async function withGitHub(test: AuthTestApp, email: string) {
  const account = await signUpWithPassword(test, email, PASSWORD)
  await postAuth(
    test,
    'email-otp/verify-email',
    { email, otp: codeFor(test, email) },
    account.cookie,
  )
  await providerLink(test, account.cookie, 'github', { id: '21', email, verified: true })
  return account
}

function disconnect(test: AuthTestApp, cookie: string, body: unknown) {
  return test.app.request('/api/account/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

const providersOf = async (test: AuthTestApp, userId: string) =>
  (await test.db.select().from(schema.account).where(eq(schema.account.userId, userId))).map(
    (a) => a.providerId,
  )

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
    await test.db
      .update(schema.session)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.session.userId, userId))

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
})
