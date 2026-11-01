import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import {
  ageSessions,
  providersOf,
  verifiedAccount,
  createAuthTestApp,
  postAuth,
  providerLink,
  signUpWithPassword,
  type AuthTestApp,
} from '../../test-utils'

const isVerified = async (test: AuthTestApp, userId: string) =>
  (await test.db.select().from(schema.user).where(eq(schema.user.id, userId)))[0]!.emailVerified

describe('connecting a provider from settings', () => {
  it('connects GitHub to a verified account', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await verifiedAccount(test, 'coach@example.com')

    const res = await providerLink(test, cookie, 'github', {
      id: '11',
      email: 'coach@example.com',
      verified: true,
    })

    expect(res.headers.get('location')).not.toContain('error=')
    expect(await providersOf(test, userId)).toContain('github')
  })

  it('asks for a sign-in within the last day', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await verifiedAccount(test, 'stale@example.com')
    await ageSessions(test, userId)

    const res = await providerLink(test, cookie, 'github', {
      id: '12',
      email: 'stale@example.com',
      verified: true,
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'SESSION_NOT_FRESH' })
  })

  it('asks an unverified account to verify first, for GitHub', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await signUpWithPassword(test, 'unverified@example.com')

    const res = await providerLink(test, cookie, 'github', {
      id: '13',
      email: 'unverified@example.com',
      verified: true,
    })

    expect(res.headers.get('location')).toContain('error=verify_email_first')
    expect(await providersOf(test, userId)).not.toContain('github')
  })

  it('connects a Google-hosted address to an unverified account, verifying it', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await signUpWithPassword(test, 'hosted@gmail.com')

    const res = await providerLink(test, cookie, 'google', {
      id: 'g-14',
      email: 'hosted@gmail.com',
      verified: true,
    })

    expect(res.headers.get('location')).not.toContain('error=')
    expect(await providersOf(test, userId)).toContain('google')
    expect(await isVerified(test, userId)).toBe(true)
  })

  it('refuses a connection whose session ended before it finished', async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await verifiedAccount(test, 'ended@example.com')

    const res = await providerLink(
      test,
      cookie,
      'github',
      { id: '15', email: 'ended@example.com', verified: true },
      () => postAuth(test, 'sign-out', {}, cookie),
    )

    expect(res.headers.get('location')).toContain('error=')
    expect(await providersOf(test, userId)).not.toContain('github')
  })

  it("refuses an address the provider doesn't report verified", async () => {
    const test = await createAuthTestApp()
    const { cookie, userId } = await verifiedAccount(test, 'unverified@example.com')

    const res = await providerLink(test, cookie, 'github', {
      id: '15',
      email: 'unverified@example.com',
      verified: false,
    })

    expect(res.headers.get('location')).toContain('error=provider_email_unverified')
    expect(await providersOf(test, userId)).not.toContain('github')
  })
})
