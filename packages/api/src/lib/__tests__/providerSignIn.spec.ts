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

async function verifiedAccount(test: AuthTestApp, email: string) {
  const account = await signUpWithPassword(test, email)
  await postAuth(
    test,
    'email-otp/verify-email',
    { email, otp: codeFor(test, email) },
    account.cookie,
  )
  return account
}

const errorOf = (res: Response) =>
  new URL(res.headers.get('location') ?? 'http://x/').searchParams.get('error')

const userByEmail = async (test: AuthTestApp, email: string) =>
  (await test.db.select().from(schema.user).where(eq(schema.user.email, email)))[0]

const providersOf = async (test: AuthTestApp, userId: string) =>
  (await test.db.select().from(schema.account).where(eq(schema.account.userId, userId))).map(
    (a) => a.providerId,
  )

describe('provider sign-in onto an existing account', () => {
  it('lets Google sign into a verified Gmail account', async () => {
    const test = await createAuthTestApp()
    const { userId } = await verifiedAccount(test, 'coach@gmail.com')

    const res = await providerSignIn(test, 'google', {
      id: 'g-1',
      email: 'coach@gmail.com',
      verified: true,
    })

    expect(errorOf(res)).toBeNull()
    expect(await providersOf(test, userId)).toContain('google')
  })

  it('lets Google sign into a verified Workspace account', async () => {
    const test = await createAuthTestApp()
    const { userId } = await verifiedAccount(test, 'coach@church.org')

    const res = await providerSignIn(test, 'google', {
      id: 'g-2',
      email: 'coach@church.org',
      verified: true,
      hd: 'church.org',
    })

    expect(errorOf(res)).toBeNull()
    expect(await providersOf(test, userId)).toContain('google')
  })

  it('refuses GitHub onto a verified account', async () => {
    const test = await createAuthTestApp()
    const { userId } = await verifiedAccount(test, 'coach@example.com')

    const res = await providerSignIn(test, 'github', {
      id: '3',
      email: 'coach@example.com',
      verified: true,
    })

    expect(errorOf(res)).toBe('account_not_linked')
    expect(await providersOf(test, userId)).toEqual(['credential'])
  })

  it("refuses Google onto a verified account for an address Google doesn't host", async () => {
    const test = await createAuthTestApp()
    const { userId } = await verifiedAccount(test, 'coach@example.com')

    const res = await providerSignIn(test, 'google', {
      id: 'g-4',
      email: 'coach@example.com',
      verified: true,
    })

    expect(errorOf(res)).toBe('account_not_linked')
    expect(await providersOf(test, userId)).toEqual(['credential'])
  })
})

describe('an address the provider reports unverified', () => {
  for (const provider of ['github', 'google'] as const) {
    it(`refuses a ${provider} sign-up and creates no user`, async () => {
      const test = await createAuthTestApp()

      const res = await providerSignIn(test, provider, {
        id: '5',
        email: 'new@gmail.com',
        verified: false,
      })

      expect(errorOf(res)).toBe('provider_email_unverified')
      expect(await userByEmail(test, 'new@gmail.com')).toBeUndefined()
    })
  }

  it('refuses a sign-in through a connected account too', async () => {
    const test = await createAuthTestApp()
    await providerSignIn(test, 'github', { id: '6', email: 'gh@example.com', verified: true })

    const res = await providerSignIn(test, 'github', {
      id: '6',
      email: 'gh@example.com',
      verified: false,
    })

    expect(errorOf(res)).toBe('provider_email_unverified')
    expect(
      res.headers
        .getSetCookie()
        .some((c) => c.includes('session_token=') && !c.includes('Max-Age=0')),
    ).toBe(false)
  })

  it('refuses one onto an existing account', async () => {
    const test = await createAuthTestApp()
    await verifiedAccount(test, 'coach@gmail.com')

    const res = await providerSignIn(test, 'google', {
      id: 'g-7',
      email: 'coach@gmail.com',
      verified: false,
    })

    expect(errorOf(res)).toBe('provider_email_unverified')
  })
})

describe('a provider sign-up', () => {
  it('starts verified when Google hosts the address', async () => {
    const test = await createAuthTestApp()
    await providerSignIn(test, 'google', { id: 'g-8', email: 'new@gmail.com', verified: true })
    expect((await userByEmail(test, 'new@gmail.com'))?.emailVerified).toBe(true)
  })

  it("starts unverified for GitHub and for an address Google doesn't host", async () => {
    const test = await createAuthTestApp()
    await providerSignIn(test, 'github', { id: '9', email: 'gh@example.com', verified: true })
    await providerSignIn(test, 'google', { id: 'g-9', email: 'g@example.com', verified: true })
    expect((await userByEmail(test, 'gh@example.com'))?.emailVerified).toBe(false)
    expect((await userByEmail(test, 'g@example.com'))?.emailVerified).toBe(false)
  })
})
