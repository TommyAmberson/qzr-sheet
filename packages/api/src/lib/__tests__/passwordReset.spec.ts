import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  codeFor,
  createAuthTestApp,
  postAuth,
  providerSignIn,
  signUpWithPassword,
  type AuthTestApp,
} from '../../test-utils'

const OLD = 'correct-horse-battery'
const NEW = 'another-good-password'

async function reset(test: AuthTestApp, email: string, password = NEW) {
  await postAuth(test, 'email-otp/request-password-reset', { email })
  return postAuth(test, 'email-otp/reset-password', { email, otp: codeFor(test, email), password })
}

const signIn = (test: AuthTestApp, email: string, password: string) =>
  postAuth(test, 'sign-in/email', { email, password })

describe('password reset', () => {
  it('sets the new password, ends every session, and verifies the address', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await signUpWithPassword(test, 'coach@example.com', OLD)

    expect((await reset(test, 'coach@example.com')).status).toBe(200)

    expect((await signIn(test, 'coach@example.com', OLD)).status).not.toBe(200)
    expect((await signIn(test, 'coach@example.com', NEW)).status).toBe(200)
    const session = await test.app.request('/api/auth/get-session', { headers: { cookie } })
    expect(await session.json()).toBeNull()
    const [row] = await test.db.select().from(schema.user).where(eq(schema.user.id, userId))
    expect(row!.emailVerified).toBe(true)
  })

  it('gives an account with only a provider its first password', async () => {
    const test = await createAuthTestApp()
    await providerSignIn(test, 'github', { id: '7', email: 'gh@example.com', verified: true })

    expect((await reset(test, 'gh@example.com')).status).toBe(200)
    expect((await signIn(test, 'gh@example.com', NEW)).status).toBe(200)
  })

  it('stops a code after three wrong tries', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'guess@example.com', OLD)
    await postAuth(test, 'email-otp/request-password-reset', { email: 'guess@example.com' })
    const code = codeFor(test, 'guess@example.com')
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 3; i++) {
      await postAuth(test, 'email-otp/reset-password', {
        email: 'guess@example.com',
        otp: wrong,
        password: NEW,
      })
    }
    const right = await postAuth(test, 'email-otp/reset-password', {
      email: 'guess@example.com',
      otp: code,
      password: NEW,
    })
    expect(right.status).not.toBe(200)
  })

  it('tells the owner the password was reset', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'told@example.com', OLD)
    const before = test.emails.length + 1

    const res = await reset(test, 'told@example.com')

    expect(await res.json()).toEqual({ success: true })
    const sent = test.emails.slice(before)
    expect(sent.map((e) => e.subject)).toEqual(['Your qzr password was reset'])
    expect(sent[0]!.text).not.toMatch(/GitHub|Google/)
  })

  // A provider sign-in added by whoever held the address before must not
  // outlive the real owner's reset (FR-025).
  it('disconnects GitHub and Google on a reset and says so', async () => {
    const test = await createAuthTestApp()
    await providerSignIn(test, 'github', { id: '8', email: 'lapsed@example.com', verified: true })
    const [row] = await test.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'lapsed@example.com'))
    const before = test.emails.length + 1

    const res = await reset(test, 'lapsed@example.com')

    expect(await res.json()).toEqual({ success: true, providersDisconnected: ['github'] })
    const accounts = await test.db
      .select()
      .from(schema.account)
      .where(eq(schema.account.userId, row!.id))
    expect(accounts.map((a) => a.providerId)).toEqual(['credential'])
    const sent = test.emails.slice(before)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toMatch(/GitHub was disconnected/)
  })

  it('cancels the account pending provider sign-ins', async () => {
    const test = await createAuthTestApp()
    const { userId } = await signUpWithPassword(test, 'pending@example.com', OLD)
    const now = new Date()
    await test.db.insert(schema.verification).values([
      {
        id: 'p1',
        identifier: 'pending-provider:mine',
        value: JSON.stringify({ userId }),
        expiresAt: new Date(now.getTime() + 600_000),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'p2',
        identifier: 'pending-provider:theirs',
        value: JSON.stringify({ userId: 'someone-else' }),
        expiresAt: new Date(now.getTime() + 600_000),
        createdAt: now,
        updatedAt: now,
      },
    ])

    await reset(test, 'pending@example.com')

    const left = (await test.db.select().from(schema.verification)).map((v) => v.identifier)
    expect(left).toContain('pending-provider:theirs')
    expect(left).not.toContain('pending-provider:mine')
  })
})
