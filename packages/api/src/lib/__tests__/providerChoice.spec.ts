import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { AccountRole } from '@qzr/shared'
import * as schema from '../../db/schema'
import {
  accountRequest,
  cookiesFrom,
  createAuthTestApp,
  postAuth,
  providerSignIn,
  seedMeet,
  providersOf,
  signUpWithPassword,
  TEST_PASSWORD as PASSWORD,
  type AuthTestApp,
} from '../../test-utils'

/** A registrant's unverified password account for a Gmail address, and a
 *  Google sign-in for it, which Google proves, waiting at the choice. */
async function atChoice(test: AuthTestApp, email: string) {
  const registrant = await signUpWithPassword(test, email, PASSWORD)
  const res = await providerSignIn(test, 'google', { id: 'g-61', email, verified: true })
  return { ...registrant, pending: cookiesFrom(res) }
}

const choose = (test: AuthTestApp, path: 'claim' | 'takeover', cookie: string) =>
  accountRequest(test, `provider/${path}`, cookie, {})

const userOf = async (test: AuthTestApp, userId: string) =>
  (await test.db.select().from(schema.user).where(eq(schema.user.id, userId)))[0]!

describe("That's me", () => {
  it('connects the provider for a session on that account and verifies it', async () => {
    const test = await createAuthTestApp()
    const { pending, userId } = await atChoice(test, 'mine@gmail.com')
    const signIn = await postAuth(test, 'sign-in/email', {
      email: 'mine@gmail.com',
      password: PASSWORD,
    })

    const res = await choose(test, 'claim', `${pending}; ${cookiesFrom(signIn)}`)

    expect(res.status).toBe(200)
    expect(await providersOf(test, userId)).toEqual(['credential', 'google'])
    expect((await userOf(test, userId)).emailVerified).toBe(true)
  })

  it('needs a session on that account', async () => {
    const test = await createAuthTestApp()
    const { pending, userId } = await atChoice(test, 'mine2@gmail.com')
    const other = await signUpWithPassword(test, 'other@example.com', PASSWORD)

    const res = await choose(test, 'claim', `${pending}; ${other.cookie}`)

    expect(res.status).toBe(403)
    expect(await providersOf(test, userId)).toEqual(['credential'])
  })
})

describe("That's not me", () => {
  it('hands the account over and signs in', async () => {
    const test = await createAuthTestApp()
    const { pending, userId, cookie: registrantSession } = await atChoice(test, 'real@gmail.com')
    const meet = await seedMeet(test.db)
    await test.db.insert(schema.adminMemberships).values({ accountId: userId, meetId: meet.id })
    await test.db.insert(schema.viewerMemberships).values({ accountId: userId, meetId: meet.id })
    await test.db
      .update(schema.user)
      .set({ role: AccountRole.Superuser })
      .where(eq(schema.user.id, userId))
    await test.db.insert(schema.account).values({
      id: 'registrant-github',
      userId,
      providerId: 'github',
      accountId: '999',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const res = await choose(test, 'takeover', pending)

    expect(res.status).toBe(200)
    expect(await providersOf(test, userId)).toEqual(['google'])
    const user = await userOf(test, userId)
    expect(user.emailVerified).toBe(true)
    expect(user.role).toBe(AccountRole.Normal)
    const admin = await test.db
      .select()
      .from(schema.adminMemberships)
      .where(eq(schema.adminMemberships.accountId, userId))
    const viewer = await test.db
      .select()
      .from(schema.viewerMemberships)
      .where(eq(schema.viewerMemberships.accountId, userId))
    expect([...admin, ...viewer]).toEqual([])
    // The registrant's session and password no longer work.
    const old = await test.app.request('/api/auth/get-session', {
      headers: { cookie: registrantSession },
    })
    expect(await old.json()).toBeNull()
    const signIn = await postAuth(test, 'sign-in/email', {
      email: 'real@gmail.com',
      password: PASSWORD,
    })
    expect(signIn.status).toBe(401)
    // The person is signed in.
    const now = await test.app.request('/api/auth/get-session', {
      headers: { cookie: cookiesFrom(res) },
    })
    expect(((await now.json()) as { user: { id: string } }).user.id).toBe(userId)
    // Their own doing: no connected or disconnected notice.
    expect(test.emails.filter((e) => /connected/.test(e.subject))).toEqual([])
  })

  it('needs the inbox proven first', async () => {
    const test = await createAuthTestApp()
    const { userId } = await signUpWithPassword(test, 'unproven@example.com', PASSWORD)
    const start = await providerSignIn(test, 'github', {
      id: '62',
      email: 'unproven@example.com',
      verified: true,
    })

    const res = await choose(test, 'takeover', cookiesFrom(start))

    expect(res.status).toBe(400)
    expect(await providersOf(test, userId)).toEqual(['credential'])
  })

  it('works once only', async () => {
    const test = await createAuthTestApp()
    const { pending } = await atChoice(test, 'once@gmail.com')

    expect((await choose(test, 'takeover', pending)).status).toBe(200)
    expect((await choose(test, 'takeover', pending)).status).toBe(400)
  })

  it('is refused once the owner has verified the address', async () => {
    const test = await createAuthTestApp()
    const { pending, userId } = await atChoice(test, 'owner@gmail.com')
    await test.db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, userId))

    expect((await choose(test, 'takeover', pending)).status).toBe(400)
    expect(await providersOf(test, userId)).toEqual(['credential'])
  })
})

describe('the account routes from another origin', () => {
  it('refuse a form post, changing nothing', async () => {
    const test = await createAuthTestApp()
    const { pending, userId } = await atChoice(test, 'forged@gmail.com')

    const res = await test.app.request('/api/account/provider/takeover', {
      method: 'POST',
      headers: { cookie: pending, 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
      body: '{}',
    })

    expect(res.status).toBe(403)
    expect(await providersOf(test, userId)).toEqual(['credential'])
    expect((await choose(test, 'takeover', pending)).status).toBe(200)
  })

  it('accept one from the app', async () => {
    const test = await createAuthTestApp()
    const { pending } = await atChoice(test, 'portal@gmail.com')

    const res = await test.app.request('/api/account/provider/takeover', {
      method: 'POST',
      headers: { cookie: pending, 'Content-Type': 'text/plain', Origin: 'http://localhost:5174' },
      body: '{}',
    })

    expect(res.status).toBe(200)
  })
})
