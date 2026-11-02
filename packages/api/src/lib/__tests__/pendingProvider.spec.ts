import { describe, it, expect } from 'vitest'
import { like } from 'drizzle-orm'
import type { SocialProvider } from '@qzr/shared'
import * as schema from '../../db/schema'
import {
  accountRequest,
  codeFor,
  cookiesFrom,
  createAuthTestApp,
  postAuth,
  providerSignIn,
  signUpWithPassword,
  type AuthTestApp,
  type ProviderProfile,
} from '../../test-utils'

/** A signed-out provider sign-in onto `email`'s unverified password account;
 *  returns the callback's response and the pending cookie it set. */
async function pendingSignIn(
  test: AuthTestApp,
  provider: SocialProvider,
  profile: Partial<ProviderProfile> & { email: string },
) {
  const res = await providerSignIn(test, provider, { id: '51', verified: true, ...profile })
  return { res, cookie: cookiesFrom(res) }
}

/** The pending sign-in's step, or with a path a POST to it. */
const step = (test: AuthTestApp, cookie: string, path = '', body?: unknown) =>
  accountRequest(test, `provider${path}`, cookie, path ? (body ?? {}) : undefined)

const codeStepEmails = (test: AuthTestApp, to: string) =>
  test.emails.filter((e) => e.to === to && e.subject.includes('to connect'))

describe('a provider sign-in onto an unverified password account', () => {
  it('sends a code and opens the code step on the portal', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'coach@example.com')

    const { res, cookie } = await pendingSignIn(test, 'github', { email: 'coach@example.com' })

    expect(res.headers.get('location')).toBe('http://localhost:5174/qzr/account/provider')
    expect(cookie).toContain('pending_provider=')
    // Sent only to the routes for this step.
    expect(res.headers.getSetCookie().find((c) => c.includes('pending_provider='))).toContain(
      'Path=/api/account/provider',
    )
    expect(codeStepEmails(test, 'coach@example.com')).toHaveLength(1)
    expect(await (await step(test, cookie)).json()).toEqual({
      step: 'code',
      provider: 'github',
      email: 'coach@example.com',
    })
  })

  it('goes straight to the choice when Google hosts the address', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'coach@gmail.com')

    const { cookie } = await pendingSignIn(test, 'google', { email: 'coach@gmail.com' })

    expect(codeStepEmails(test, 'coach@gmail.com')).toHaveLength(0)
    expect(await (await step(test, cookie)).json()).toMatchObject({ step: 'choice' })
  })

  it('leads to the choice once the code is entered', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'right@example.com')
    const { cookie } = await pendingSignIn(test, 'github', { email: 'right@example.com' })

    const wrong = await step(test, cookie, '/confirm', { code: '000000' })
    expect(await wrong.json()).toMatchObject({ code: 'INVALID_OTP' })

    const right = await step(test, cookie, '/confirm', { code: codeFor(test, 'right@example.com') })
    expect(right.status).toBe(200)
    expect(await (await step(test, cookie)).json()).toMatchObject({ step: 'choice' })
  })

  it('ends the sign-in after three wrong codes', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'guess@example.com')
    const { cookie } = await pendingSignIn(test, 'github', { email: 'guess@example.com' })
    const code = codeFor(test, 'guess@example.com')
    const wrongCode = code === '000000' ? '111111' : '000000'

    await step(test, cookie, '/confirm', { code: wrongCode })
    await step(test, cookie, '/confirm', { code: wrongCode })
    const third = await step(test, cookie, '/confirm', { code: wrongCode })

    expect(await third.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' })
    expect((await step(test, cookie, '/confirm', { code })).status).toBe(400)
  })

  it('answers a used, expired or unknown cookie the same way', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'old@example.com')
    const { cookie } = await pendingSignIn(test, 'github', { email: 'old@example.com' })
    await test.db
      .update(schema.verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(schema.verification.identifier, 'pending-provider:%'))

    const answers = await Promise.all([
      step(test, cookie),
      step(test, 'qzr.pending_provider=unknown'),
      step(test, ''),
    ])
    const bodies = await Promise.all(answers.map((r) => r.json()))
    expect(answers.map((r) => r.status)).toEqual([400, 400, 400])
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
  })

  it('resends under the per-address limit', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'resend@example.com')
    const { cookie } = await pendingSignIn(test, 'github', { email: 'resend@example.com' })

    const first = codeFor(test, 'resend@example.com')
    expect((await step(test, cookie, '/resend')).status).toBe(200)
    expect((await step(test, cookie, '/resend')).status).toBe(200)
    expect((await step(test, cookie, '/resend')).status).toBe(429)
    expect(codeStepEmails(test, 'resend@example.com')).toHaveLength(3)
    // A resend replaces the old code.
    const latest = codeFor(test, 'resend@example.com')
    if (latest !== first) {
      expect((await step(test, cookie, '/confirm', { code: first })).status).toBe(400)
    }
    expect((await step(test, cookie, '/confirm', { code: latest })).status).toBe(200)
  })

  it("doesn't let the code step's code verify the address", async () => {
    const test = await createAuthTestApp()
    const { cookie: session } = await signUpWithPassword(test, 'only@example.com')
    await pendingSignIn(test, 'github', { email: 'only@example.com' })

    const res = await postAuth(
      test,
      'email-otp/verify-email',
      { email: 'only@example.com', otp: codeFor(test, 'only@example.com') },
      session,
    )

    expect(res.status).not.toBe(200)
  })

  it('sends an account without a password to its provider', async () => {
    const test = await createAuthTestApp()
    await providerSignIn(test, 'github', { id: '52', email: 'gh@example.com', verified: true })

    const { res } = await pendingSignIn(test, 'google', { id: 'g-52', email: 'gh@example.com' })

    expect(res.headers.get('location')).toContain('error=sign_in_with_provider')
  })

  it('is cancelled by a password reset', async () => {
    const test = await createAuthTestApp()
    await signUpWithPassword(test, 'reset@gmail.com')
    const { cookie } = await pendingSignIn(test, 'google', { email: 'reset@gmail.com' })
    await postAuth(test, 'email-otp/request-password-reset', { email: 'reset@gmail.com' })
    await postAuth(test, 'email-otp/reset-password', {
      email: 'reset@gmail.com',
      otp: codeFor(test, 'reset@gmail.com'),
      password: 'another-good-password',
    })

    expect((await step(test, cookie)).status).toBe(400)
  })
})
