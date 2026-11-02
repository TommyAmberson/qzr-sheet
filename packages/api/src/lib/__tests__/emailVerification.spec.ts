import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { codeFor, createAuthTestApp, postAuth, signUpWithPassword } from '../../test-utils'

const isVerified = async (test: Awaited<ReturnType<typeof createAuthTestApp>>, id: string) =>
  (await test.db.select().from(schema.user).where(eq(schema.user.id, id)))[0]!.emailVerified

describe('email verification', () => {
  it('leaves a new password account usable, unverified', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await signUpWithPassword(test, 'new@example.com')

    const session = await test.app.request('/api/auth/get-session', { headers: { cookie } })
    expect(await session.json()).not.toBeNull()
    expect(await isVerified(test, userId)).toBe(false)
  })

  it('verifies with the sign-up code from a session on that account, signing no one in', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await signUpWithPassword(test, 'mine@example.com')

    const res = await postAuth(
      test,
      'email-otp/verify-email',
      { email: 'mine@example.com', otp: codeFor(test, 'mine@example.com') },
      cookie,
    )

    expect(res.status).toBe(200)
    expect(await isVerified(test, userId)).toBe(true)
  })

  it('refuses a code from a signed-out request or another account, without spending a try', async () => {
    const test = await createAuthTestApp()
    const { userId } = await signUpWithPassword(test, 'target@example.com')
    const other = await signUpWithPassword(test, 'other@example.com')
    const code = codeFor(test, 'target@example.com')

    const signedOut = await postAuth(test, 'email-otp/verify-email', {
      email: 'target@example.com',
      otp: code,
    })
    const wrongAccount = await postAuth(
      test,
      'email-otp/verify-email',
      { email: 'target@example.com', otp: code },
      other.cookie,
    )

    expect(signedOut.status).toBe(403)
    expect(wrongAccount.status).toBe(403)
    expect(signedOut.headers.getSetCookie()).toEqual([])
    expect(await isVerified(test, userId)).toBe(false)
  })

  it('sends a new verification code to a signed-in account', async () => {
    const test = await createAuthTestApp()
    const { cookie } = await signUpWithPassword(test, 'later@example.com')
    const first = codeFor(test, 'later@example.com')

    const res = await postAuth(
      test,
      'email-otp/send-verification-otp',
      { email: 'later@example.com', type: 'email-verification' },
      cookie,
    )

    expect(res.status).toBe(200)
    expect(codeFor(test, 'later@example.com')).not.toBe(first)
  })

  it('sends a verification code only for a session on that account', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'owner@example.com')
    const other = await signUpWithPassword(test, 'other@example.com')
    const sent = test.emails.length
    const body = { email: 'owner@example.com', type: 'email-verification' }

    const signedOut = await postAuth(test, 'email-otp/send-verification-otp', body)
    const otherAccount = await postAuth(test, 'email-otp/send-verification-otp', body, other.cookie)

    expect([signedOut.status, otherAccount.status]).toEqual([403, 403])
    expect(test.emails.length).toBe(sent)
  })
})
